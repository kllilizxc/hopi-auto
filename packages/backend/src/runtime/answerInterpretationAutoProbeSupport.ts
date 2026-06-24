import {
  type InterpretableAnswerSourceInput,
  type ResolvedAnswerSourceEntry,
  createResolvedAnswerSources,
} from './answerInterpretationAnswerSourceSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import { AutoSourceResponseTerminalError } from './answerInterpretationFormatSupport'
import type {
  CanonicalQuestionAnchorMatch,
  EmbeddedMatchingRunToken,
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
  LabeledSourceResponseSection,
} from './answerInterpretationTypes'

type ConcreteInterpretableSourceResponseFormat = Exclude<InterpretableSourceResponseFormat, 'auto'>

type ParsedValueList = ArrayLike<unknown>

type ParsedValueListParser = (
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => ParsedValueList

type ParsedSectionMapParser = (
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => Map<string, LabeledSourceResponseSection>

type AnswerSourceEntryListParser = (
  answerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => ResolvedAnswerSourceEntry[]

type LabeledSectionAuthorityGuard = (
  sourceResponse: string | undefined,
  labeledSections: Map<string, LabeledSourceResponseSection>,
) => void

type InlineTopicAuthorityGuard = (
  sourceResponse: string | undefined,
  inlineTopicSections: Map<string, LabeledSourceResponseSection>,
  consumedInlineTopicLabels: Set<string>,
) => void

interface AnswerInterpretationAutoProbeSupportDependencies {
  assertDirectInlineTopicsDidNotSkipStandaloneQuestionAuthority: InlineTopicAuthorityGuard
  assertDirectInlineTopicsDidNotSkipStandaloneTopicAuthority: InlineTopicAuthorityGuard
  assertAutoLabeledSectionsDidNotSkipStandaloneQuestionAuthority: LabeledSectionAuthorityGuard
  assertAutoLabeledSectionsDidNotSkipStandaloneTopicAuthority: LabeledSectionAuthorityGuard
  assertExplicitLabelTextDoesNotContainAuthority: (label: string, labelType: string) => void
  assertLabeledValueAuthorityMatchesLabel: (
    label: string,
    value: string,
    labelType: string,
    valueType: string,
  ) => void
  assertSeparatorStyleInlineTopicsDidNotMixWithAdditionalVerbalInlineTopicAuthority: (
    sourceResponse: string | undefined,
  ) => void
  assertTextDoesNotContainMalformedStandaloneQuestionSpanAuthority: (text: string) => void
  autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => boolean
  autoInlineTopicsShouldYieldToExplicitTopicAuthority: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => boolean
  autoQuestionSurfaceEstablishedExplicitAuthority: (
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => boolean
  autoTopicSurfaceEstablishedExplicitAuthority: (
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => boolean
  collectSemanticallyValidInlineTopicClauseIndexes: (sourceResponse: string) => Set<number>
  dedupeNonEmptyStrings: (values: string[]) => string[]
  extractQuestionAuthorityTextsFromText: (text: string) => string[]
  formatQuotedValueList: (values: string[]) => string
  groupRemainingNonInlineTopicClauseChunks: (
    sourceResponse: string,
    semanticallyValidInlineTopicClauseIndexes: Set<number>,
  ) => string[]
  inlineTopicClauseUsesNonLabeledSectionExplicitLabelValueSeparator: (
    trimmedClause: string,
  ) => boolean
  isQuestionSourceResponseSentence: (text: string) => boolean
  orderedBlocksCollapsedMarkedOrderedItems: (
    sourceResponse: string | undefined,
    orderedBlocks: string[] | undefined,
  ) => boolean
  parseInlineTopicClause: (clause: string) => LabeledSourceResponseSection | undefined
  parseMatchingClosingSourceResponseRuns: ParsedValueListParser
  parseMatchingMiddleSourceResponseRuns: ParsedValueListParser
  parseMatchingOpeningSourceResponseRuns: ParsedValueListParser
  parseMatchingSourceResponseRuns: ParsedValueListParser
  parseQuestionSourceResponseClauses: (sourceResponse: string) => ArrayLike<unknown>
  parseRequiredInlineTopicSections: ParsedSectionMapParser
  parseRequiredLabeledSourceResponseSections: ParsedSectionMapParser
  parseRequiredMatchingAnswerSourceEntries: AnswerSourceEntryListParser
  parseRequiredOrderedSourceResponseBlocks: ParsedValueListParser
  parseRequiredOrderedSourceResponseItems: ParsedValueListParser
  parseRequiredPendingAnswerSourceEntries: AnswerSourceEntryListParser
  parseRequiredPendingSourceResponseClauses: ParsedValueListParser
  parseRequiredPendingSourceResponseConjunctions: ParsedValueListParser
  parseRequiredPendingSourceResponseParagraphs: ParsedValueListParser
  parseRequiredPendingSourceResponseSentences: ParsedValueListParser
  parseRequiredQuestionSourceResponseBlocks: ParsedValueListParser
  parseRequiredQuestionSourceResponseClauses: ParsedValueListParser
  parseRequiredQuestionSourceResponseClosingBlocks: ParsedValueListParser
  parseRequiredQuestionSourceResponseClosingSpans: ParsedValueListParser
  parseRequiredQuestionSourceResponseMiddleBlocks: ParsedValueListParser
  parseRequiredQuestionSourceResponseMiddleSpans: ParsedValueListParser
  parseRequiredQuestionSourceResponseSpans: ParsedValueListParser
  parseRequiredTopicSourceResponseBlocks: ParsedValueListParser
  parseRequiredTopicSourceResponseClauses: ParsedValueListParser
  parseRequiredTopicSourceResponseClosingBlocks: ParsedValueListParser
  parseRequiredTopicSourceResponseClosingSpans: ParsedValueListParser
  parseRequiredTopicSourceResponseMiddleBlocks: ParsedValueListParser
  parseRequiredTopicSourceResponseMiddleSpans: ParsedValueListParser
  parseRequiredTopicSourceResponseParagraphs: ParsedValueListParser
  parseRequiredTopicSourceResponseSentences: ParsedValueListParser
  parseRequiredTopicSourceResponseSpans: ParsedValueListParser
  resolveCanonicalQuestionAnchorMatch: (
    text: string,
    tokens: EmbeddedMatchingRunToken[],
    startIndex: number,
  ) => CanonicalQuestionAnchorMatch | undefined
  splitInlineTopicClauses: (sourceResponse: string) => string[]
  sourceResponseHasQuestionSentenceAuthority: (sourceResponse: string | undefined) => boolean
  stripLeadingPresentationListMarkers: (text: string) => string
  tokenizeEmbeddedMatchingRunSourceResponse: (sourceResponse: string) => EmbeddedMatchingRunToken[]
}

type AutoSourceResponseFormatCompletenessInput = {
  sourceResponse?: string
  answerSources?: InterpretableAnswerSourceInput[]
  sourceResponseFormat: ConcreteInterpretableSourceResponseFormat
  sourceResponseState: InterpretedSourceResponseState | undefined
  inferDecisionTopics?: boolean
  inferRemainingAnswers?: boolean
}

export function createAnswerInterpretationAutoProbeSupport(
  dependencies: AnswerInterpretationAutoProbeSupportDependencies,
) {
  function assertAutoSourceResponseUnitCompleteness(
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    unitLabel: string,
    consumedCount: number,
    totalCount: number,
  ) {
    if (consumedCount >= totalCount) {
      return
    }

    const remainingCount = totalCount - consumedCount
    throw new AnswerInterpretationError(
      `sourceResponseFormat auto rejected ${sourceResponseFormat} because it left ${remainingCount} unconsumed ${unitLabel}.`,
    )
  }

  function assertAutoParsedValueListCompleteness(input: {
    sourceResponse?: string
    sourceResponseState?: InterpretedSourceResponseState
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat
    unitLabel: string
    consumedCount: number
    parseValues: ParsedValueListParser
  }) {
    assertAutoSourceResponseUnitCompleteness(
      input.sourceResponseFormat,
      input.unitLabel,
      input.consumedCount,
      input.parseValues(
        input.sourceResponse,
        'sourceResponseFormat auto',
        input.sourceResponseState,
      ).length,
    )
  }

  function assertAutoSourceResponseFormatCompleteness(
    input: AutoSourceResponseFormatCompletenessInput,
  ) {
    const state = input.sourceResponseState
    if (!state) {
      return
    }

    switch (input.sourceResponseFormat) {
      case 'single_pending': {
        if (!state.singlePendingConsumed) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat auto rejected single_pending because it did not consume the pending reply.',
          )
        }
        return
      }
      case 'pending_clauses':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'pending clauses',
          consumedCount: state.nextPendingClauseIndex,
          parseValues: dependencies.parseRequiredPendingSourceResponseClauses,
        })
        return
      case 'pending_paragraphs':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'pending paragraphs',
          consumedCount: state.nextPendingParagraphIndex,
          parseValues: dependencies.parseRequiredPendingSourceResponseParagraphs,
        })
        return
      case 'pending_sentences':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'pending sentences',
          consumedCount: state.nextPendingSentenceIndex,
          parseValues: dependencies.parseRequiredPendingSourceResponseSentences,
        })
        return
      case 'pending_conjunctions':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'pending conjunction segments',
          consumedCount: state.nextPendingConjunctionIndex,
          parseValues: dependencies.parseRequiredPendingSourceResponseConjunctions,
        })
        return
      case 'pending_answer_sources': {
        if (input.inferDecisionTopics && !input.inferRemainingAnswers) {
          return
        }
        const entries = dependencies.parseRequiredPendingAnswerSourceEntries(
          createResolvedAnswerSources(input.answerSources, input.sourceResponse)?.entries,
          'sourceResponseFormat auto',
          state,
        )
        assertAutoSourceResponseUnitCompleteness(
          input.sourceResponseFormat,
          'pending answer sources',
          state.nextPendingAnswerSourceIndex,
          entries.length,
        )
        return
      }
      case 'matching_answer_sources': {
        if (input.inferDecisionTopics && !input.inferRemainingAnswers) {
          return
        }
        const entries = dependencies.parseRequiredMatchingAnswerSourceEntries(
          createResolvedAnswerSources(input.answerSources, input.sourceResponse)?.entries,
          'sourceResponseFormat auto',
          state,
        )
        assertAutoSourceResponseUnitCompleteness(
          input.sourceResponseFormat,
          'matching answer sources',
          state.consumedMatchingAnswerSourceIndexes.size,
          entries.length,
        )
        return
      }
      case 'matching_runs':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'matching runs',
          consumedCount: state.consumedMatchingRunIndexes.size,
          parseValues: dependencies.parseMatchingSourceResponseRuns,
        })
        return
      case 'matching_opening_runs':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'matching opening runs',
          consumedCount: state.consumedMatchingOpeningRunIndexes.size,
          parseValues: dependencies.parseMatchingOpeningSourceResponseRuns,
        })
        return
      case 'matching_closing_runs':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'matching closing runs',
          consumedCount: state.consumedMatchingClosingRunIndexes.size,
          parseValues: dependencies.parseMatchingClosingSourceResponseRuns,
        })
        return
      case 'matching_middle_runs':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'matching middle runs',
          consumedCount: state.consumedMatchingMiddleRunIndexes.size,
          parseValues: dependencies.parseMatchingMiddleSourceResponseRuns,
        })
        return
      case 'ordered_items':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'ordered items',
          consumedCount: state.nextOrderedItemIndex,
          parseValues: dependencies.parseRequiredOrderedSourceResponseItems,
        })
        return
      case 'ordered_blocks':
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'ordered blocks',
          consumedCount: state.nextOrderedBlockIndex,
          parseValues: dependencies.parseRequiredOrderedSourceResponseBlocks,
        })
        return
      case 'question_blocks':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'question blocks',
          consumedCount: state.consumedQuestionBlockIndexes.size,
          parseValues: dependencies.parseRequiredQuestionSourceResponseBlocks,
        })
        return
      case 'question_clauses':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'question clauses',
          consumedCount: state.consumedQuestionClauseIndexes.size,
          parseValues: dependencies.parseRequiredQuestionSourceResponseClauses,
        })
        return
      case 'question_spans':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'question spans',
          consumedCount: state.consumedQuestionSpanIndexes.size,
          parseValues: dependencies.parseRequiredQuestionSourceResponseSpans,
        })
        return
      case 'question_middle_spans':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'question middle spans',
          consumedCount: state.consumedQuestionMiddleSpanIndexes.size,
          parseValues: dependencies.parseRequiredQuestionSourceResponseMiddleSpans,
        })
        return
      case 'question_closing_spans':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'question closing spans',
          consumedCount: state.consumedQuestionClosingSpanIndexes.size,
          parseValues: dependencies.parseRequiredQuestionSourceResponseClosingSpans,
        })
        return
      case 'question_closing_blocks':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'question closing blocks',
          consumedCount: state.consumedQuestionClosingBlockIndexes.size,
          parseValues: dependencies.parseRequiredQuestionSourceResponseClosingBlocks,
        })
        return
      case 'question_middle_blocks':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'question middle blocks',
          consumedCount: state.consumedQuestionMiddleBlockIndexes.size,
          parseValues: dependencies.parseRequiredQuestionSourceResponseMiddleBlocks,
        })
        return
      case 'topic_clauses':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'topic clauses',
          consumedCount: state.consumedTopicClauseIndexes.size,
          parseValues: dependencies.parseRequiredTopicSourceResponseClauses,
        })
        return
      case 'topic_sentences':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'topic sentences',
          consumedCount: state.consumedTopicSentenceIndexes.size,
          parseValues: dependencies.parseRequiredTopicSourceResponseSentences,
        })
        return
      case 'topic_spans':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'topic spans',
          consumedCount: state.consumedTopicSpanIndexes.size,
          parseValues: dependencies.parseRequiredTopicSourceResponseSpans,
        })
        return
      case 'topic_middle_spans':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'topic middle spans',
          consumedCount: state.consumedTopicMiddleSpanIndexes.size,
          parseValues: dependencies.parseRequiredTopicSourceResponseMiddleSpans,
        })
        return
      case 'topic_closing_spans':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'topic closing spans',
          consumedCount: state.consumedTopicClosingSpanIndexes.size,
          parseValues: dependencies.parseRequiredTopicSourceResponseClosingSpans,
        })
        return
      case 'topic_closing_blocks':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'topic closing blocks',
          consumedCount: state.consumedTopicClosingBlockIndexes.size,
          parseValues: dependencies.parseRequiredTopicSourceResponseClosingBlocks,
        })
        return
      case 'topic_paragraphs':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'topic paragraphs',
          consumedCount: state.consumedTopicParagraphIndexes.size,
          parseValues: dependencies.parseRequiredTopicSourceResponseParagraphs,
        })
        return
      case 'topic_middle_blocks':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'topic middle blocks',
          consumedCount: state.consumedTopicMiddleBlockIndexes.size,
          parseValues: dependencies.parseRequiredTopicSourceResponseMiddleBlocks,
        })
        return
      case 'topic_blocks':
        if (input.inferDecisionTopics) {
          return
        }
        assertAutoParsedValueListCompleteness({
          sourceResponse: input.sourceResponse,
          sourceResponseState: state,
          sourceResponseFormat: input.sourceResponseFormat,
          unitLabel: 'topic blocks',
          consumedCount: state.consumedTopicBlockIndexes.size,
          parseValues: dependencies.parseRequiredTopicSourceResponseBlocks,
        })
        return
      case 'labeled_sections': {
        const labeledSections = dependencies.parseRequiredLabeledSourceResponseSections(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        )
        assertAutoSourceResponseUnitCompleteness(
          input.sourceResponseFormat,
          'labeled sections',
          state.consumedLabeledSectionLabels.size,
          labeledSections.size,
        )
        dependencies.assertAutoLabeledSectionsDidNotSkipStandaloneQuestionAuthority(
          input.sourceResponse,
          labeledSections,
        )
        dependencies.assertAutoLabeledSectionsDidNotSkipStandaloneTopicAuthority(
          input.sourceResponse,
          labeledSections,
        )
        return
      }
      case 'inline_topics':
        assertAutoSourceResponseUnitCompleteness(
          input.sourceResponseFormat,
          'inline topic clauses',
          state.consumedInlineTopicLabels.size,
          dependencies.parseRequiredInlineTopicSections(
            input.sourceResponse,
            'sourceResponseFormat auto',
            state,
          ).size,
        )
        return
    }
  }

  function shouldAutoSourceResponseProbeFailClosed(
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    if (sourceResponseFormat === 'pending_answer_sources') {
      return (sourceResponseState?.pendingAnswerSourceEntries?.length ?? 0) > 0
    }
    if (sourceResponseFormat === 'labeled_sections') {
      return (sourceResponseState?.labeledSections?.size ?? 0) > 0
    }
    if (sourceResponseFormat === 'inline_topics') {
      if (dependencies.autoInlineTopicsShouldYieldToExplicitTopicAuthority(sourceResponseState)) {
        return false
      }
      return (sourceResponseState?.inlineTopics?.size ?? 0) > 1
    }
    if (sourceResponseFormat === 'ordered_items') {
      return (
        (sourceResponseState?.orderedItems?.length ?? 0) > 1 &&
        (sourceResponseState?.nextOrderedItemIndex ?? 0) > 0
      )
    }
    if (sourceResponseFormat === 'ordered_blocks') {
      return (
        ((sourceResponseState?.orderedBlocks?.length ?? 0) > 1 &&
          (sourceResponseState?.nextOrderedBlockIndex ?? 0) > 0) ||
        dependencies.orderedBlocksCollapsedMarkedOrderedItems(
          sourceResponseState?.sourceResponse,
          sourceResponseState?.orderedBlocks,
        )
      )
    }
    if (sourceResponseFormat === 'question_blocks') {
      return dependencies.autoQuestionSurfaceEstablishedExplicitAuthority(
        sourceResponseFormat,
        sourceResponseState,
      )
    }
    if (sourceResponseFormat === 'question_clauses') {
      return (
        dependencies.autoQuestionSurfaceEstablishedExplicitAuthority(
          sourceResponseFormat,
          sourceResponseState,
        ) ||
        dependencies.sourceResponseHasQuestionSentenceAuthority(sourceResponseState?.sourceResponse)
      )
    }
    if (
      sourceResponseFormat === 'question_spans' ||
      sourceResponseFormat === 'question_middle_spans' ||
      sourceResponseFormat === 'question_closing_spans' ||
      sourceResponseFormat === 'question_closing_blocks' ||
      sourceResponseFormat === 'question_middle_blocks'
    ) {
      return dependencies.autoQuestionSurfaceEstablishedExplicitAuthority(
        sourceResponseFormat,
        sourceResponseState,
      )
    }
    if (
      sourceResponseFormat === 'topic_clauses' ||
      sourceResponseFormat === 'topic_sentences' ||
      sourceResponseFormat === 'topic_spans' ||
      sourceResponseFormat === 'topic_middle_spans' ||
      sourceResponseFormat === 'topic_closing_spans' ||
      sourceResponseFormat === 'topic_closing_blocks' ||
      sourceResponseFormat === 'topic_paragraphs' ||
      sourceResponseFormat === 'topic_middle_blocks' ||
      sourceResponseFormat === 'topic_blocks'
    ) {
      return dependencies.autoTopicSurfaceEstablishedExplicitAuthority(
        sourceResponseFormat,
        sourceResponseState,
      )
    }
    if (sourceResponseFormat === 'matching_opening_runs') {
      return (sourceResponseState?.consumedMatchingOpeningRunIndexes.size ?? 0) > 0
    }
    if (sourceResponseFormat === 'matching_closing_runs') {
      return (sourceResponseState?.consumedMatchingClosingRunIndexes.size ?? 0) > 0
    }
    if (sourceResponseFormat === 'matching_middle_runs') {
      return (sourceResponseState?.consumedMatchingMiddleRunIndexes.size ?? 0) > 0
    }
    return false
  }

  function isTerminalLabelFamilyAutoProbeError(
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    error: unknown,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const message = error instanceof Error ? error.message : String(error)
    if (sourceResponseFormat === 'labeled_sections') {
      return (
        message.startsWith('Labeled section label "') ||
        message.startsWith('Duplicate labeled section "') ||
        message.includes('included another labeled section inside its value')
      )
    }
    if (sourceResponseFormat !== 'inline_topics') {
      return false
    }
    if (
      message.includes('still included standalone question authority') &&
      message.includes('outside inline topic clauses')
    ) {
      return true
    }
    if (
      message.includes('still included standalone topic authority for ') &&
      message.includes('outside inline topic clauses')
    ) {
      return !dependencies.autoInlineTopicsShouldYieldToExplicitTopicAuthority(sourceResponseState)
    }
    if (message.includes('included incomplete topic authority for "')) {
      return !dependencies.autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics(
        sourceResponseState,
      )
    }
    return (
      message.startsWith('Inline topic clause label "') ||
      message.startsWith('Duplicate inline topic clause "') ||
      message.includes('included answer text with explicit topic authority for "') ||
      message.includes('included question authority "')
    )
  }

  function inlineTopicQuestionAuthorityShouldYieldToQuestionFamily(clause: string) {
    const trimmedClause = dependencies.stripLeadingPresentationListMarkers(
      clause.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (!trimmedClause) {
      return false
    }

    if (dependencies.isQuestionSourceResponseSentence(trimmedClause)) {
      return true
    }

    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(trimmedClause)
    if (dependencies.resolveCanonicalQuestionAnchorMatch(trimmedClause, tokens, 0)) {
      return true
    }

    try {
      return dependencies.parseQuestionSourceResponseClauses(trimmedClause).length > 0
    } catch (error) {
      if (error instanceof AnswerInterpretationError) {
        return false
      }
      throw error
    }
  }

  function assertAutoDidNotSkipMalformedExplicitInlineTopicAuthority(
    sourceResponse: string | undefined,
  ) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      return
    }

    try {
      if (dependencies.parseRequiredLabeledSourceResponseSections(shared, 'sourceResponse').size > 0) {
        return
      }
    } catch (error) {
      if (error instanceof AnswerInterpretationError) {
        return
      }
      throw error
    }

    for (const clause of dependencies.splitInlineTopicClauses(shared)) {
      const trimmedClause = dependencies.stripLeadingPresentationListMarkers(
        clause.trim().replace(/^(?:and|but)\s+/i, ''),
      )
      if (
        !trimmedClause ||
        !dependencies.inlineTopicClauseUsesNonLabeledSectionExplicitLabelValueSeparator(
          trimmedClause,
        )
      ) {
        continue
      }

      const parsed = dependencies.parseInlineTopicClause(clause)
      if (!parsed) {
        continue
      }

      try {
        dependencies.assertExplicitLabelTextDoesNotContainAuthority(
          parsed.label,
          'Inline topic clause label',
        )
        dependencies.assertLabeledValueAuthorityMatchesLabel(
          parsed.label,
          parsed.value,
          'Inline topic clause',
          'answer text',
        )
      } catch (error) {
        if (error instanceof AnswerInterpretationError) {
          throw new AutoSourceResponseTerminalError(error.message)
        }
        throw error
      }
    }

    for (const clause of dependencies.splitInlineTopicClauses(shared)) {
      const parsed = dependencies.parseInlineTopicClause(clause)
      if (!parsed) {
        continue
      }

      try {
        dependencies.assertLabeledValueAuthorityMatchesLabel(
          parsed.label,
          parsed.value,
          'Inline topic clause',
          'answer text',
        )
      } catch (error) {
        if (
          error instanceof AnswerInterpretationError &&
          error.message.includes('included question authority "') &&
          !inlineTopicQuestionAuthorityShouldYieldToQuestionFamily(clause)
        ) {
          throw new AutoSourceResponseTerminalError(error.message)
        }
        if (!(error instanceof AnswerInterpretationError)) {
          throw error
        }
      }
    }

    const semanticallyValidInlineTopicClauseIndexes =
      dependencies.collectSemanticallyValidInlineTopicClauseIndexes(shared)
    if (semanticallyValidInlineTopicClauseIndexes.size === 0) {
      return
    }

    for (const chunk of dependencies.groupRemainingNonInlineTopicClauseChunks(
      shared,
      semanticallyValidInlineTopicClauseIndexes,
    )) {
      dependencies.assertTextDoesNotContainMalformedStandaloneQuestionSpanAuthority(chunk)
    }

    const standaloneQuestionAuthorities = dependencies.dedupeNonEmptyStrings(
      dependencies.splitInlineTopicClauses(shared).flatMap((clause, clauseIndex) =>
        semanticallyValidInlineTopicClauseIndexes.has(clauseIndex)
          ? []
          : dependencies.extractQuestionAuthorityTextsFromText(clause),
      ),
    )
    if (standaloneQuestionAuthorities.length > 0) {
      throw new AutoSourceResponseTerminalError(
        `sourceResponseFormat inline_topics rejected sourceResponse because it still included standalone question authority ${dependencies.formatQuotedValueList(standaloneQuestionAuthorities)} outside inline topic clauses.`,
      )
    }
  }

  function assertAutoPlanningDidNotSkipUnsupportedExplicitLabelAuthority(
    followThrough: { inferRemainingAnswers?: boolean } | undefined,
    sourceResponse: string | undefined,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    if (followThrough?.inferRemainingAnswers !== true || !sourceResponse?.trim()) {
      return
    }

    let labeledSections: Map<string, LabeledSourceResponseSection>
    try {
      labeledSections = dependencies.parseRequiredLabeledSourceResponseSections(
        sourceResponse,
        'sourceResponseFormat auto',
        sourceResponseState,
      )
    } catch (error) {
      if (error instanceof AnswerInterpretationError) {
        throw new AutoSourceResponseTerminalError(error.message)
      }
      throw error
    }
    for (const section of labeledSections.values()) {
      try {
        dependencies.assertLabeledValueAuthorityMatchesLabel(
          section.label,
          section.value,
          'Labeled section',
          'value text',
        )
      } catch (error) {
        if (error instanceof AnswerInterpretationError) {
          throw new AutoSourceResponseTerminalError(error.message)
        }
        throw error
      }
    }
    if (labeledSections.size > 0) {
      try {
        dependencies.assertAutoLabeledSectionsDidNotSkipStandaloneQuestionAuthority(
          sourceResponse,
          labeledSections,
        )
        dependencies.assertAutoLabeledSectionsDidNotSkipStandaloneTopicAuthority(
          sourceResponse,
          labeledSections,
        )
      } catch (error) {
        if (error instanceof AnswerInterpretationError) {
          throw new AutoSourceResponseTerminalError(error.message)
        }
        throw error
      }
      throw new AutoSourceResponseTerminalError(
        'sourceResponse established explicit labeled section authority, but inferRemainingAnswers does not support labeled_sections.',
      )
    }
    assertAutoDidNotSkipMalformedExplicitInlineTopicAuthority(sourceResponse)
    if (dependencies.sourceResponseHasQuestionSentenceAuthority(sourceResponse)) {
      return
    }

    let inlineTopics: Map<string, LabeledSourceResponseSection>
    try {
      inlineTopics = dependencies.parseRequiredInlineTopicSections(
        sourceResponse,
        'sourceResponseFormat auto',
        sourceResponseState,
      )
    } catch (error) {
      if (error instanceof AnswerInterpretationError) {
        throw new AutoSourceResponseTerminalError(error.message)
      }
      throw error
    }
    for (const section of inlineTopics.values()) {
      try {
        dependencies.assertLabeledValueAuthorityMatchesLabel(
          section.label,
          section.value,
          'Inline topic clause',
          'answer text',
        )
      } catch (error) {
        if (
          error instanceof AnswerInterpretationError &&
          error.message.includes('included incomplete topic authority for "') &&
          dependencies.autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics(
            sourceResponseState,
          )
        ) {
          continue
        }
        if (error instanceof AnswerInterpretationError) {
          throw new AutoSourceResponseTerminalError(error.message)
        }
        throw error
      }
    }
    if (
      inlineTopics.size > 0 &&
      !dependencies.autoInlineTopicsShouldYieldToExplicitTopicAuthority(sourceResponseState)
    ) {
      try {
        const consumedInlineTopicLabels = new Set(inlineTopics.keys())
        dependencies.assertDirectInlineTopicsDidNotSkipStandaloneQuestionAuthority(
          sourceResponse,
          inlineTopics,
          consumedInlineTopicLabels,
        )
        dependencies.assertDirectInlineTopicsDidNotSkipStandaloneTopicAuthority(
          sourceResponse,
          inlineTopics,
          consumedInlineTopicLabels,
        )
        dependencies.assertSeparatorStyleInlineTopicsDidNotMixWithAdditionalVerbalInlineTopicAuthority(
          sourceResponse,
        )
      } catch (error) {
        if (error instanceof AnswerInterpretationError) {
          throw new AutoSourceResponseTerminalError(error.message)
        }
        throw error
      }
      throw new AutoSourceResponseTerminalError(
        'sourceResponse established explicit inline topic authority, but inferRemainingAnswers does not support inline_topics.',
      )
    }
  }

  function assertAutoSourceResponseFormatDidNotStopAtWeakerInlineTopics(
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    if (
      sourceResponseFormat === 'inline_topics' &&
      dependencies.autoInlineTopicsShouldYieldToExplicitTopicAuthority(sourceResponseState)
    ) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat inline_topics yielded weaker label/value authority than an explicit topic surface already present in sourceResponse.',
      )
    }
  }

  return {
    assertAutoDidNotSkipMalformedExplicitInlineTopicAuthority,
    assertAutoPlanningDidNotSkipUnsupportedExplicitLabelAuthority,
    assertAutoSourceResponseFormatCompleteness,
    assertAutoSourceResponseFormatDidNotStopAtWeakerInlineTopics,
    isTerminalLabelFamilyAutoProbeError,
    shouldAutoSourceResponseProbeFailClosed,
  }
}
