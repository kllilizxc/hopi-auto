import {
  type InterpretableAnswerSourceInput,
  type ResolvedAnswerSourceEntry,
  createResolvedAnswerSources,
} from './answerInterpretationAnswerSourceSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
  LabeledSourceResponseSection,
} from './answerInterpretationTypes'

type ConcreteInterpretableSourceResponseFormat = Exclude<InterpretableSourceResponseFormat, 'auto'>

type QuestionSourceResponseFormat =
  | 'question_blocks'
  | 'question_clauses'
  | 'question_spans'
  | 'question_middle_spans'
  | 'question_closing_spans'
  | 'question_closing_blocks'
  | 'question_middle_blocks'

type DirectSourceResponseCompletenessInput = {
  sourceResponse?: string
  sourceResponseFormat?: InterpretableSourceResponseFormat
  sourceResponseState?: InterpretedSourceResponseState
  label: string
}

type DirectLabelFamilySourceResponseCompletenessInput = DirectSourceResponseCompletenessInput & {
  enforceDirectLabeledSectionCompleteness?: boolean
}

type DirectAnswerSourceFamilySourceResponseCompletenessInput =
  DirectSourceResponseCompletenessInput & {
    answerSources?: InterpretableAnswerSourceInput[]
  }

type ParsedUnitList = ArrayLike<unknown>

type CachedSectionParser = (
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => Map<string, LabeledSourceResponseSection>

type CachedParsedUnitListParser = (
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => ParsedUnitList

type ParsedQuestionUnitListParser = (sourceResponse: string) => ParsedUnitList

type AnswerSourceEntryParser = (
  answerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => ResolvedAnswerSourceEntry[]

interface DirectSourceResponseCompletenessDependencies {
  parseRequiredLabeledSourceResponseSections: CachedSectionParser
  parseRequiredInlineTopicSections: CachedSectionParser
  assertDirectLabeledSectionsDidNotSkipStandaloneQuestionAuthority: (
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) => void
  assertDirectLabeledSectionsDidNotSkipStandaloneTopicAuthority: (
    sourceResponse: string | undefined,
    labeledSections: Map<string, LabeledSourceResponseSection>,
  ) => void
  assertDirectInlineTopicsDidNotSkipStandaloneQuestionAuthority: (
    sourceResponse: string | undefined,
    inlineTopics: Map<string, LabeledSourceResponseSection>,
    consumedInlineTopicLabels: Set<string> | undefined,
  ) => void
  assertDirectInlineTopicsDidNotSkipStandaloneTopicAuthority: (
    sourceResponse: string | undefined,
    inlineTopics: Map<string, LabeledSourceResponseSection>,
    consumedInlineTopicLabels: Set<string> | undefined,
  ) => void
  parseQuestionSourceResponseBlocks: ParsedQuestionUnitListParser
  parseQuestionSourceResponseClauses: ParsedQuestionUnitListParser
  parseQuestionSourceResponseSpans: ParsedQuestionUnitListParser
  parseQuestionSourceResponseMiddleSpans: ParsedQuestionUnitListParser
  parseQuestionSourceResponseClosingSpans: ParsedQuestionUnitListParser
  parseQuestionSourceResponseClosingBlocks: ParsedQuestionUnitListParser
  parseQuestionSourceResponseMiddleBlocks: ParsedQuestionUnitListParser
  parseRequiredTopicSourceResponseClauses: CachedParsedUnitListParser
  parseRequiredTopicSourceResponseSentences: CachedParsedUnitListParser
  parseRequiredTopicSourceResponseSpans: CachedParsedUnitListParser
  parseRequiredTopicSourceResponseMiddleSpans: CachedParsedUnitListParser
  parseRequiredTopicSourceResponseClosingSpans: CachedParsedUnitListParser
  parseRequiredTopicSourceResponseClosingBlocks: CachedParsedUnitListParser
  parseRequiredTopicSourceResponseParagraphs: CachedParsedUnitListParser
  parseRequiredTopicSourceResponseMiddleBlocks: CachedParsedUnitListParser
  parseRequiredTopicSourceResponseBlocks: CachedParsedUnitListParser
  parseRequiredOrderedSourceResponseItems: CachedParsedUnitListParser
  parseRequiredOrderedSourceResponseBlocks: CachedParsedUnitListParser
  parseRequiredPendingSourceResponseClauses: CachedParsedUnitListParser
  parseRequiredPendingSourceResponseParagraphs: CachedParsedUnitListParser
  parseRequiredPendingSourceResponseSentences: CachedParsedUnitListParser
  parseRequiredPendingSourceResponseConjunctions: CachedParsedUnitListParser
  parseRequiredPendingAnswerSourceEntries: AnswerSourceEntryParser
  parseRequiredMatchingAnswerSourceEntries: AnswerSourceEntryParser
  parseMatchingSourceResponseRuns: CachedParsedUnitListParser
  parseMatchingOpeningSourceResponseRuns: CachedParsedUnitListParser
  parseMatchingClosingSourceResponseRuns: CachedParsedUnitListParser
  parseMatchingMiddleSourceResponseRuns: CachedParsedUnitListParser
}

export function createDirectSourceResponseCompletenessSupport(
  dependencies: DirectSourceResponseCompletenessDependencies,
) {
  function assertDirectSourceResponseUnitCompleteness(
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
      `sourceResponseFormat ${sourceResponseFormat} rejected sourceResponse because it left ${remainingCount} unconsumed ${unitLabel}.`,
    )
  }

  function parseRequiredQuestionSourceResponseUnits(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseFormat: QuestionSourceResponseFormat,
    cached: ParsedUnitList | undefined,
    parse: ParsedQuestionUnitListParser,
  ) {
    if (cached) {
      return cached
    }

    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} requires sourceResponse for ${label}.`,
      )
    }

    return parse(shared)
  }

  function resolveRequiredAnswerSourceEntries(
    input: DirectAnswerSourceFamilySourceResponseCompletenessInput,
    parse: AnswerSourceEntryParser,
  ) {
    return parse(
      createResolvedAnswerSources(input.answerSources, input.sourceResponse)?.entries,
      input.label,
      input.sourceResponseState,
    )
  }

  function assertDirectLabelFamilySourceResponseCompleteness(
    input: DirectLabelFamilySourceResponseCompletenessInput,
  ) {
    if (
      input.enforceDirectLabeledSectionCompleteness !== false &&
      input.sourceResponseFormat === 'labeled_sections' &&
      (input.sourceResponseState?.consumedLabeledSectionLabels.size ?? 0) > 0
    ) {
      const labeledSections = dependencies.parseRequiredLabeledSourceResponseSections(
        input.sourceResponse,
        input.label,
        input.sourceResponseState,
      )
      assertDirectSourceResponseUnitCompleteness(
        'labeled_sections',
        'labeled sections',
        input.sourceResponseState?.consumedLabeledSectionLabels.size ?? 0,
        labeledSections.size,
      )
      dependencies.assertDirectLabeledSectionsDidNotSkipStandaloneQuestionAuthority(
        input.sourceResponse,
        labeledSections,
      )
      dependencies.assertDirectLabeledSectionsDidNotSkipStandaloneTopicAuthority(
        input.sourceResponse,
        labeledSections,
      )
    }

    if (
      input.sourceResponseFormat === 'inline_topics' &&
      (input.sourceResponseState?.consumedInlineTopicLabels.size ?? 0) > 0
    ) {
      const inlineTopics = dependencies.parseRequiredInlineTopicSections(
        input.sourceResponse,
        input.label,
        input.sourceResponseState,
      )
      assertDirectSourceResponseUnitCompleteness(
        'inline_topics',
        'inline topic clauses',
        input.sourceResponseState?.consumedInlineTopicLabels.size ?? 0,
        inlineTopics.size,
      )
      dependencies.assertDirectInlineTopicsDidNotSkipStandaloneQuestionAuthority(
        input.sourceResponse,
        inlineTopics,
        input.sourceResponseState?.consumedInlineTopicLabels,
      )
      dependencies.assertDirectInlineTopicsDidNotSkipStandaloneTopicAuthority(
        input.sourceResponse,
        inlineTopics,
        input.sourceResponseState?.consumedInlineTopicLabels,
      )
    }
  }

  function assertDirectQuestionAndTopicSourceResponseCompleteness(
    input: DirectSourceResponseCompletenessInput,
  ) {
    const state = input.sourceResponseState

    if (
      input.sourceResponseFormat === 'question_blocks' &&
      (state?.consumedQuestionBlockIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'question_blocks',
        'question blocks',
        state?.consumedQuestionBlockIndexes.size ?? 0,
        parseRequiredQuestionSourceResponseUnits(
          input.sourceResponse,
          input.label,
          'question_blocks',
          state?.questionBlocks,
          dependencies.parseQuestionSourceResponseBlocks,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'question_clauses' &&
      (state?.consumedQuestionClauseIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'question_clauses',
        'question clauses',
        state?.consumedQuestionClauseIndexes.size ?? 0,
        parseRequiredQuestionSourceResponseUnits(
          input.sourceResponse,
          input.label,
          'question_clauses',
          state?.questionClauses,
          dependencies.parseQuestionSourceResponseClauses,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'question_spans' &&
      (state?.consumedQuestionSpanIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'question_spans',
        'question spans',
        state?.consumedQuestionSpanIndexes.size ?? 0,
        parseRequiredQuestionSourceResponseUnits(
          input.sourceResponse,
          input.label,
          'question_spans',
          state?.questionSpans,
          dependencies.parseQuestionSourceResponseSpans,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'question_middle_spans' &&
      (state?.consumedQuestionMiddleSpanIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'question_middle_spans',
        'question middle spans',
        state?.consumedQuestionMiddleSpanIndexes.size ?? 0,
        parseRequiredQuestionSourceResponseUnits(
          input.sourceResponse,
          input.label,
          'question_middle_spans',
          state?.questionMiddleSpans,
          dependencies.parseQuestionSourceResponseMiddleSpans,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'question_closing_spans' &&
      (state?.consumedQuestionClosingSpanIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'question_closing_spans',
        'question closing spans',
        state?.consumedQuestionClosingSpanIndexes.size ?? 0,
        parseRequiredQuestionSourceResponseUnits(
          input.sourceResponse,
          input.label,
          'question_closing_spans',
          state?.questionClosingSpans,
          dependencies.parseQuestionSourceResponseClosingSpans,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'question_closing_blocks' &&
      (state?.consumedQuestionClosingBlockIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'question_closing_blocks',
        'question closing blocks',
        state?.consumedQuestionClosingBlockIndexes.size ?? 0,
        parseRequiredQuestionSourceResponseUnits(
          input.sourceResponse,
          input.label,
          'question_closing_blocks',
          state?.questionClosingBlocks,
          dependencies.parseQuestionSourceResponseClosingBlocks,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'question_middle_blocks' &&
      (state?.consumedQuestionMiddleBlockIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'question_middle_blocks',
        'question middle blocks',
        state?.consumedQuestionMiddleBlockIndexes.size ?? 0,
        parseRequiredQuestionSourceResponseUnits(
          input.sourceResponse,
          input.label,
          'question_middle_blocks',
          state?.questionMiddleBlocks,
          dependencies.parseQuestionSourceResponseMiddleBlocks,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'topic_clauses' &&
      (state?.consumedTopicClauseIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'topic_clauses',
        'topic clauses',
        state?.consumedTopicClauseIndexes.size ?? 0,
        dependencies.parseRequiredTopicSourceResponseClauses(
          input.sourceResponse,
          input.label,
          state,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'topic_sentences' &&
      (state?.consumedTopicSentenceIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'topic_sentences',
        'topic sentences',
        state?.consumedTopicSentenceIndexes.size ?? 0,
        dependencies.parseRequiredTopicSourceResponseSentences(
          input.sourceResponse,
          input.label,
          state,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'topic_spans' &&
      (state?.consumedTopicSpanIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'topic_spans',
        'topic spans',
        state?.consumedTopicSpanIndexes.size ?? 0,
        dependencies.parseRequiredTopicSourceResponseSpans(input.sourceResponse, input.label, state)
          .length,
      )
    }

    if (
      input.sourceResponseFormat === 'topic_middle_spans' &&
      (state?.consumedTopicMiddleSpanIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'topic_middle_spans',
        'topic middle spans',
        state?.consumedTopicMiddleSpanIndexes.size ?? 0,
        dependencies.parseRequiredTopicSourceResponseMiddleSpans(
          input.sourceResponse,
          input.label,
          state,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'topic_closing_spans' &&
      (state?.consumedTopicClosingSpanIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'topic_closing_spans',
        'topic closing spans',
        state?.consumedTopicClosingSpanIndexes.size ?? 0,
        dependencies.parseRequiredTopicSourceResponseClosingSpans(
          input.sourceResponse,
          input.label,
          state,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'topic_closing_blocks' &&
      (state?.consumedTopicClosingBlockIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'topic_closing_blocks',
        'topic closing blocks',
        state?.consumedTopicClosingBlockIndexes.size ?? 0,
        dependencies.parseRequiredTopicSourceResponseClosingBlocks(
          input.sourceResponse,
          input.label,
          state,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'topic_paragraphs' &&
      (state?.consumedTopicParagraphIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'topic_paragraphs',
        'topic paragraphs',
        state?.consumedTopicParagraphIndexes.size ?? 0,
        dependencies.parseRequiredTopicSourceResponseParagraphs(
          input.sourceResponse,
          input.label,
          state,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'topic_middle_blocks' &&
      (state?.consumedTopicMiddleBlockIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'topic_middle_blocks',
        'topic middle blocks',
        state?.consumedTopicMiddleBlockIndexes.size ?? 0,
        dependencies.parseRequiredTopicSourceResponseMiddleBlocks(
          input.sourceResponse,
          input.label,
          state,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'topic_blocks' &&
      (state?.consumedTopicBlockIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'topic_blocks',
        'topic blocks',
        state?.consumedTopicBlockIndexes.size ?? 0,
        dependencies.parseRequiredTopicSourceResponseBlocks(
          input.sourceResponse,
          input.label,
          state,
        ).length,
      )
    }
  }

  function assertDirectOrderedSourceResponseCompleteness(
    input: DirectSourceResponseCompletenessInput,
  ) {
    if (
      input.sourceResponseFormat === 'ordered_items' &&
      (input.sourceResponseState?.nextOrderedItemIndex ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'ordered_items',
        'ordered items',
        input.sourceResponseState?.nextOrderedItemIndex ?? 0,
        dependencies.parseRequiredOrderedSourceResponseItems(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'ordered_blocks' &&
      (input.sourceResponseState?.nextOrderedBlockIndex ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'ordered_blocks',
        'ordered blocks',
        input.sourceResponseState?.nextOrderedBlockIndex ?? 0,
        dependencies.parseRequiredOrderedSourceResponseBlocks(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }
  }

  function assertDirectPendingSourceResponseCompleteness(
    input: DirectSourceResponseCompletenessInput,
  ) {
    if (
      input.sourceResponseFormat === 'pending_clauses' &&
      (input.sourceResponseState?.nextPendingClauseIndex ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'pending_clauses',
        'pending clauses',
        input.sourceResponseState?.nextPendingClauseIndex ?? 0,
        dependencies.parseRequiredPendingSourceResponseClauses(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'pending_paragraphs' &&
      (input.sourceResponseState?.nextPendingParagraphIndex ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'pending_paragraphs',
        'pending paragraphs',
        input.sourceResponseState?.nextPendingParagraphIndex ?? 0,
        dependencies.parseRequiredPendingSourceResponseParagraphs(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'pending_sentences' &&
      (input.sourceResponseState?.nextPendingSentenceIndex ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'pending_sentences',
        'pending sentences',
        input.sourceResponseState?.nextPendingSentenceIndex ?? 0,
        dependencies.parseRequiredPendingSourceResponseSentences(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'pending_conjunctions' &&
      (input.sourceResponseState?.nextPendingConjunctionIndex ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'pending_conjunctions',
        'pending conjunctions',
        input.sourceResponseState?.nextPendingConjunctionIndex ?? 0,
        dependencies.parseRequiredPendingSourceResponseConjunctions(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }
  }

  function assertDirectAnswerSourceFamilySourceResponseCompleteness(
    input: DirectAnswerSourceFamilySourceResponseCompletenessInput,
  ) {
    if (
      input.sourceResponseFormat === 'pending_answer_sources' &&
      (input.sourceResponseState?.nextPendingAnswerSourceIndex ?? 0) > 0
    ) {
      const entries = resolveRequiredAnswerSourceEntries(
        input,
        dependencies.parseRequiredPendingAnswerSourceEntries,
      )
      assertDirectSourceResponseUnitCompleteness(
        'pending_answer_sources',
        'pending answer sources',
        input.sourceResponseState?.nextPendingAnswerSourceIndex ?? 0,
        entries.length,
      )
    }

    if (
      input.sourceResponseFormat === 'matching_answer_sources' &&
      (input.sourceResponseState?.consumedMatchingAnswerSourceIndexes.size ?? 0) > 0
    ) {
      const entries = resolveRequiredAnswerSourceEntries(
        input,
        dependencies.parseRequiredMatchingAnswerSourceEntries,
      )
      assertDirectSourceResponseUnitCompleteness(
        'matching_answer_sources',
        'matching answer sources',
        input.sourceResponseState?.consumedMatchingAnswerSourceIndexes.size ?? 0,
        entries.length,
      )
    }
  }

  function assertDirectMatchingRunSourceResponseCompleteness(
    input: DirectSourceResponseCompletenessInput,
  ) {
    if (
      input.sourceResponseFormat === 'matching_runs' &&
      (input.sourceResponseState?.consumedMatchingRunIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'matching_runs',
        'matching runs',
        input.sourceResponseState?.consumedMatchingRunIndexes.size ?? 0,
        dependencies.parseMatchingSourceResponseRuns(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'matching_opening_runs' &&
      (input.sourceResponseState?.consumedMatchingOpeningRunIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'matching_opening_runs',
        'matching opening runs',
        input.sourceResponseState?.consumedMatchingOpeningRunIndexes.size ?? 0,
        dependencies.parseMatchingOpeningSourceResponseRuns(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'matching_closing_runs' &&
      (input.sourceResponseState?.consumedMatchingClosingRunIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'matching_closing_runs',
        'matching closing runs',
        input.sourceResponseState?.consumedMatchingClosingRunIndexes.size ?? 0,
        dependencies.parseMatchingClosingSourceResponseRuns(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }

    if (
      input.sourceResponseFormat === 'matching_middle_runs' &&
      (input.sourceResponseState?.consumedMatchingMiddleRunIndexes.size ?? 0) > 0
    ) {
      assertDirectSourceResponseUnitCompleteness(
        'matching_middle_runs',
        'matching middle runs',
        input.sourceResponseState?.consumedMatchingMiddleRunIndexes.size ?? 0,
        dependencies.parseMatchingMiddleSourceResponseRuns(
          input.sourceResponse,
          input.label,
          input.sourceResponseState,
        ).length,
      )
    }
  }

  function assertNoUnusedExplicitlyRoutedAnswerSources(
    input: DirectAnswerSourceFamilySourceResponseCompletenessInput,
  ) {
    const state = input.sourceResponseState
    if (!state) {
      return
    }

    if (input.sourceResponseFormat === 'pending_answer_sources') {
      const entries = resolveRequiredAnswerSourceEntries(
        input,
        dependencies.parseRequiredPendingAnswerSourceEntries,
      )
      const unusedEntry = entries
        .slice(state.nextPendingAnswerSourceIndex)
        .find((entry) => entry.route !== undefined)
      if (!unusedEntry?.route) {
        return
      }
      throw new AnswerInterpretationError(
        `sourceResponseFormat pending_answer_sources left explicit route "${unusedEntry.route}" on answerSource "${unusedEntry.key}" unused after materializing ${input.label}.`,
      )
    }

    if (input.sourceResponseFormat === 'matching_answer_sources') {
      const entries = resolveRequiredAnswerSourceEntries(
        input,
        dependencies.parseRequiredMatchingAnswerSourceEntries,
      )
      const unusedEntry = entries.find(
        (entry, index) =>
          entry.route !== undefined && !state.consumedMatchingAnswerSourceIndexes.has(index),
      )
      if (!unusedEntry?.route) {
        return
      }
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_answer_sources left explicit route "${unusedEntry.route}" on answerSource "${unusedEntry.key}" unused after materializing ${input.label}.`,
      )
    }
  }

  return {
    assertDirectAnswerSourceFamilySourceResponseCompleteness,
    assertDirectLabelFamilySourceResponseCompleteness,
    assertDirectMatchingRunSourceResponseCompleteness,
    assertDirectOrderedSourceResponseCompleteness,
    assertDirectPendingSourceResponseCompleteness,
    assertDirectQuestionAndTopicSourceResponseCompleteness,
    assertNoUnusedExplicitlyRoutedAnswerSources,
  }
}
