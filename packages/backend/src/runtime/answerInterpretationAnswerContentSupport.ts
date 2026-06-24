import type { AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import {
  type PendingAnswerSourceConsumerDescriptor,
  type ResolvedAnswerSourceEntry,
  resolveSourceExcerpt,
} from './answerInterpretationAnswerSourceSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
  QuestionSourceResponseBlock,
  QuestionSourceResponseClosingBlock,
  QuestionSourceResponseClosingSpan,
  QuestionSourceResponseSpan,
  ResolvedAnswerContent,
} from './answerInterpretationTypes'

type PendingSourceResponseValueResolver = (
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => string

type PendingAnswerSourceValueResolver = (
  pendingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
  consumerDescriptor?: PendingAnswerSourceConsumerDescriptor,
) => string

type MatchingAnswerSourceValueResolver = (
  matchingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
  consumerFamily?: PendingAnswerSourceConsumerDescriptor['family'],
) => string

type MatchingRunValueResolver = (
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => string

type QuestionSourceResponseMatchConsumer<TMatch extends { question: string; answer: string }> = (
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) => TMatch | undefined

type TopicSourceResponseSectionConsumer = (
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
  rejectMultipleInferredTopicSummariesInTopicUnits?: boolean,
) => string | undefined

interface AnswerContentSupportDependencies {
  assertMatchedAnswerTextAuthorityMatchesConsumer: (
    answer: string,
    candidates: string[],
    consumerLabel: string,
    sourceLabel?: 'answerSource' | 'sourceResponse',
  ) => void
  consumeQuestionBlockSourceResponseMatch: QuestionSourceResponseMatchConsumer<QuestionSourceResponseBlock>
  consumeQuestionClauseSourceResponseMatch: QuestionSourceResponseMatchConsumer<QuestionSourceResponseSpan>
  consumeQuestionClosingBlockSourceResponseMatch: QuestionSourceResponseMatchConsumer<QuestionSourceResponseClosingBlock>
  consumeQuestionClosingSpanSourceResponseMatch: QuestionSourceResponseMatchConsumer<QuestionSourceResponseClosingSpan>
  consumeQuestionMiddleBlockSourceResponseMatch: QuestionSourceResponseMatchConsumer<QuestionSourceResponseBlock>
  consumeQuestionMiddleSpanSourceResponseMatch: QuestionSourceResponseMatchConsumer<QuestionSourceResponseSpan>
  consumeQuestionSpanSourceResponseMatch: QuestionSourceResponseMatchConsumer<QuestionSourceResponseSpan>
  consumeSinglePendingSourceResponse: PendingSourceResponseValueResolver
  consumeTopicBlockSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicClauseSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicClosingBlockSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicClosingSpanSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicMiddleBlockSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicMiddleSpanSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicParagraphSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicSentenceSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicSpanSourceResponseSection: TopicSourceResponseSectionConsumer
  resolveInlineTopicSourceResponseSection: (
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => string
  resolveLabeledSourceResponseSection: (
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => string
  resolveMatchingAnswerSourceValue: MatchingAnswerSourceValueResolver
  resolveMatchingClosingRunSourceResponseValue: MatchingRunValueResolver
  resolveMatchingMiddleRunSourceResponseValue: MatchingRunValueResolver
  resolveMatchingOpeningRunSourceResponseValue: MatchingRunValueResolver
  resolveMatchingRunSourceResponseValue: MatchingRunValueResolver
  resolveOrderedSourceResponseBlock: PendingSourceResponseValueResolver
  resolveOrderedSourceResponseItem: PendingSourceResponseValueResolver
  resolvePendingAnswerSourceValue: PendingAnswerSourceValueResolver
  resolvePendingSourceResponseClause: PendingSourceResponseValueResolver
  resolvePendingSourceResponseConjunction: PendingSourceResponseValueResolver
  resolvePendingSourceResponseParagraph: PendingSourceResponseValueResolver
  resolvePendingSourceResponseSentence: PendingSourceResponseValueResolver
}

export function createAnswerInterpretationAnswerContentSupport(
  dependencies: AnswerContentSupportDependencies,
) {
  function toAnswerCaptureFormat(
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  ): AnswerCaptureFormat | undefined {
    if (!sourceResponseFormat || sourceResponseFormat === 'auto') {
      return undefined
    }
    return sourceResponseFormat
  }

  function resolveAnswerContent(
    answer: string | undefined,
    sourceExcerpt: string | undefined,
    sourceOccurrence: number | undefined,
    answerSourceKey: string | undefined,
    answerSourceGroupKey: string | undefined,
    sourceResponse: string | undefined,
    label: string,
    answerSourcesByKey?: Map<string, string>,
    answerSourceGroupsByKey?: Map<string, string>,
    pendingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
    matchingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
    sourceResponseFormat?: InterpretableSourceResponseFormat,
    sourceResponseCandidates: string[] = [],
    sourceResponseState?: InterpretedSourceResponseState,
    pendingAnswerSourceConsumerDescriptor?: PendingAnswerSourceConsumerDescriptor,
    rejectMultipleInferredTopicSummariesInTopicUnits = false,
  ): ResolvedAnswerContent {
    const explicit = answer?.trim()
    if (explicit) {
      return { answer: explicit }
    }

    const directExcerpt = resolveSourceExcerpt(
      sourceExcerpt,
      sourceOccurrence,
      sourceResponse,
      label,
    )
    if (directExcerpt) {
      return { answer: directExcerpt }
    }

    const captureFormat = toAnswerCaptureFormat(sourceResponseFormat)
    const interpreted = (content: ResolvedAnswerContent): ResolvedAnswerContent =>
      captureFormat ? { ...content, captureFormat } : content

    const namedAnswerSource = resolveNamedAnswerSourceContent({
      answerSourceCandidates: sourceResponseCandidates,
      answerSourceGroupKey,
      answerSourceGroupsByKey,
      answerSourceKey,
      answerSourcesByKey,
      label,
    })
    if (namedAnswerSource) {
      return interpreted(namedAnswerSource)
    }

    if (sourceResponseFormat === 'labeled_sections') {
      return interpreted({
        answer: dependencies.resolveLabeledSourceResponseSection(
          sourceResponse,
          sourceResponseCandidates,
          label,
          sourceResponseState,
        ),
      })
    }

    if (sourceResponseFormat === 'single_pending') {
      return interpreted({
        answer: assertSourceResponseAuthorityMatch(
          dependencies.consumeSinglePendingSourceResponse(
            sourceResponse,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Single pending reply for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'pending_clauses') {
      return interpreted({
        answer: assertSourceResponseAuthorityMatch(
          dependencies.resolvePendingSourceResponseClause(
            sourceResponse,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Pending clause for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'pending_paragraphs') {
      return interpreted({
        answer: assertSourceResponseAuthorityMatch(
          dependencies.resolvePendingSourceResponseParagraph(
            sourceResponse,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Pending paragraph for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'pending_sentences') {
      return interpreted({
        answer: assertSourceResponseAuthorityMatch(
          dependencies.resolvePendingSourceResponseSentence(
            sourceResponse,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Pending sentence for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'pending_conjunctions') {
      return interpreted({
        answer: assertSourceResponseAuthorityMatch(
          dependencies.resolvePendingSourceResponseConjunction(
            sourceResponse,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Pending conjunction for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'pending_answer_sources') {
      return interpreted({
        answer: assertAnswerSourceAuthorityMatch(
          dependencies.resolvePendingAnswerSourceValue(
            pendingAnswerSourceEntries,
            label,
            sourceResponseState,
            pendingAnswerSourceConsumerDescriptor,
          ),
          sourceResponseCandidates,
          `Pending answerSource for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'matching_answer_sources') {
      return interpreted({
        answer: assertAnswerSourceAuthorityMatch(
          dependencies.resolveMatchingAnswerSourceValue(
            matchingAnswerSourceEntries,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            pendingAnswerSourceConsumerDescriptor?.family,
          ),
          sourceResponseCandidates,
          `Matching answerSource for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'matching_runs') {
      return interpreted({
        answer: assertMatchingRunAuthorityMatch(
          dependencies.resolveMatchingRunSourceResponseValue(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Matching run for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'matching_opening_runs') {
      return interpreted({
        answer: assertMatchingRunAuthorityMatch(
          dependencies.resolveMatchingOpeningRunSourceResponseValue(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Matching opening run for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'matching_closing_runs') {
      return interpreted({
        answer: assertMatchingRunAuthorityMatch(
          dependencies.resolveMatchingClosingRunSourceResponseValue(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Matching closing run for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'matching_middle_runs') {
      return interpreted({
        answer: assertMatchingRunAuthorityMatch(
          dependencies.resolveMatchingMiddleRunSourceResponseValue(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Matching middle run for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'ordered_items') {
      return interpreted({
        answer: assertSourceResponseAuthorityMatch(
          dependencies.resolveOrderedSourceResponseItem(
            sourceResponse,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Ordered item for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'ordered_blocks') {
      return interpreted({
        answer: assertSourceResponseAuthorityMatch(
          dependencies.resolveOrderedSourceResponseBlock(
            sourceResponse,
            label,
            sourceResponseState,
          ),
          sourceResponseCandidates,
          `Ordered block for ${label}`,
        ),
      })
    }

    if (sourceResponseFormat === 'question_blocks') {
      return interpreted(
        resolveQuestionSurfaceAnswerContent(
          dependencies.consumeQuestionBlockSourceResponseMatch(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No question block matched ${label} in sourceResponse.`,
        ),
      )
    }

    if (sourceResponseFormat === 'question_clauses') {
      return interpreted(
        resolveQuestionSurfaceAnswerContent(
          dependencies.consumeQuestionClauseSourceResponseMatch(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No question clause matched ${label} in sourceResponse.`,
        ),
      )
    }

    if (sourceResponseFormat === 'question_spans') {
      return interpreted(
        resolveQuestionSurfaceAnswerContent(
          dependencies.consumeQuestionSpanSourceResponseMatch(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No question span matched ${label} in sourceResponse.`,
        ),
      )
    }

    if (sourceResponseFormat === 'question_middle_spans') {
      return interpreted(
        resolveQuestionSurfaceAnswerContent(
          dependencies.consumeQuestionMiddleSpanSourceResponseMatch(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No question middle span matched ${label} in sourceResponse.`,
        ),
      )
    }

    if (sourceResponseFormat === 'question_closing_spans') {
      return interpreted(
        resolveQuestionSurfaceAnswerContent(
          dependencies.consumeQuestionClosingSpanSourceResponseMatch(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No question closing span matched ${label} in sourceResponse.`,
        ),
      )
    }

    if (sourceResponseFormat === 'question_closing_blocks') {
      return interpreted(
        resolveQuestionSurfaceAnswerContent(
          dependencies.consumeQuestionClosingBlockSourceResponseMatch(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No question closing block matched ${label} in sourceResponse.`,
        ),
      )
    }

    if (sourceResponseFormat === 'question_middle_blocks') {
      return interpreted(
        resolveQuestionSurfaceAnswerContent(
          dependencies.consumeQuestionMiddleBlockSourceResponseMatch(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No question middle block matched ${label} in sourceResponse.`,
        ),
      )
    }

    if (sourceResponseFormat === 'inline_topics') {
      return interpreted({
        answer: dependencies.resolveInlineTopicSourceResponseSection(
          sourceResponse,
          sourceResponseCandidates,
          label,
          sourceResponseState,
        ),
      })
    }

    if (sourceResponseFormat === 'topic_clauses') {
      return interpreted({
        answer: resolveTopicSurfaceAnswer(
          dependencies.consumeTopicClauseSourceResponseSection(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
            rejectMultipleInferredTopicSummariesInTopicUnits,
          ),
          `No topic clause matched ${label} in sourceResponse.`,
        ),
      })
    }

    if (sourceResponseFormat === 'topic_sentences') {
      return interpreted({
        answer: resolveTopicSurfaceAnswer(
          dependencies.consumeTopicSentenceSourceResponseSection(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
            rejectMultipleInferredTopicSummariesInTopicUnits,
          ),
          `No topic sentence matched ${label} in sourceResponse.`,
        ),
      })
    }

    if (sourceResponseFormat === 'topic_spans') {
      return interpreted({
        answer: resolveTopicSurfaceAnswer(
          dependencies.consumeTopicSpanSourceResponseSection(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No topic span matched ${label} in sourceResponse.`,
        ),
      })
    }

    if (sourceResponseFormat === 'topic_middle_spans') {
      return interpreted({
        answer: resolveTopicSurfaceAnswer(
          dependencies.consumeTopicMiddleSpanSourceResponseSection(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No topic middle span matched ${label} in sourceResponse.`,
        ),
      })
    }

    if (sourceResponseFormat === 'topic_closing_spans') {
      return interpreted({
        answer: resolveTopicSurfaceAnswer(
          dependencies.consumeTopicClosingSpanSourceResponseSection(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
          ),
          `No topic closing span matched ${label} in sourceResponse.`,
        ),
      })
    }

    if (sourceResponseFormat === 'topic_closing_blocks') {
      return interpreted({
        answer: resolveTopicSurfaceAnswer(
          dependencies.consumeTopicClosingBlockSourceResponseSection(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
            rejectMultipleInferredTopicSummariesInTopicUnits,
          ),
          `No topic closing block matched ${label} in sourceResponse.`,
        ),
      })
    }

    if (sourceResponseFormat === 'topic_paragraphs') {
      return interpreted({
        answer: resolveTopicSurfaceAnswer(
          dependencies.consumeTopicParagraphSourceResponseSection(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
            rejectMultipleInferredTopicSummariesInTopicUnits,
          ),
          `No topic paragraph matched ${label} in sourceResponse.`,
        ),
      })
    }

    if (sourceResponseFormat === 'topic_middle_blocks') {
      return interpreted({
        answer: resolveTopicSurfaceAnswer(
          dependencies.consumeTopicMiddleBlockSourceResponseSection(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
            rejectMultipleInferredTopicSummariesInTopicUnits,
          ),
          `No topic middle block matched ${label} in sourceResponse.`,
        ),
      })
    }

    if (sourceResponseFormat === 'topic_blocks') {
      return interpreted({
        answer: resolveTopicSurfaceAnswer(
          dependencies.consumeTopicBlockSourceResponseSection(
            sourceResponse,
            sourceResponseCandidates,
            label,
            sourceResponseState,
            true,
            rejectMultipleInferredTopicSummariesInTopicUnits,
          ),
          `No topic block matched ${label} in sourceResponse.`,
        ),
      })
    }

    const shared = sourceResponse?.trim()
    if (shared) {
      return interpreted({ answer: shared })
    }

    throw new AnswerInterpretationError(
      `Missing answer text for ${label}. Provide item.answer, answerSourceKey, answerSourceGroupKey, or sourceResponse.`,
    )
  }

  function resolveNamedAnswerSourceContent(input: {
    answerSourceCandidates: string[]
    answerSourceGroupKey: string | undefined
    answerSourceGroupsByKey?: Map<string, string>
    answerSourceKey: string | undefined
    answerSourcesByKey?: Map<string, string>
    label: string
  }) {
    const referencedSourceKey = input.answerSourceKey?.trim()
    const referencedSourceGroupKey = input.answerSourceGroupKey?.trim()
    if (referencedSourceKey && referencedSourceGroupKey) {
      throw new AnswerInterpretationError(
        `Provide only answerSourceKey or answerSourceGroupKey for ${input.label}.`,
      )
    }

    if (referencedSourceKey) {
      const sourced = input.answerSourcesByKey?.get(referencedSourceKey)
      if (!sourced) {
        throw new AnswerInterpretationError(
          `Unknown answerSourceKey "${referencedSourceKey}" for ${input.label}.`,
        )
      }
      return {
        answer: assertAnswerSourceAuthorityMatch(
          sourced,
          input.answerSourceCandidates,
          `Named answerSource "${referencedSourceKey}" for ${input.label}`,
        ),
      }
    }

    if (referencedSourceGroupKey) {
      const sourced = input.answerSourceGroupsByKey?.get(referencedSourceGroupKey)
      if (!sourced) {
        throw new AnswerInterpretationError(
          `Unknown answerSourceGroupKey "${referencedSourceGroupKey}" for ${input.label}.`,
        )
      }
      return {
        answer: assertAnswerSourceAuthorityMatch(
          sourced,
          input.answerSourceCandidates,
          `Named answerSource group "${referencedSourceGroupKey}" for ${input.label}`,
        ),
      }
    }

    return undefined
  }

  function assertSourceResponseAuthorityMatch(
    resolvedAnswer: string,
    candidates: string[],
    consumerLabel: string,
  ) {
    dependencies.assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      candidates,
      consumerLabel,
      'sourceResponse',
    )
    return resolvedAnswer
  }

  function assertAnswerSourceAuthorityMatch(
    resolvedAnswer: string,
    candidates: string[],
    consumerLabel: string,
  ) {
    dependencies.assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      candidates,
      consumerLabel,
      'answerSource',
    )
    return resolvedAnswer
  }

  function assertMatchingRunAuthorityMatch(
    resolvedAnswer: string,
    candidates: string[],
    consumerLabel: string,
  ) {
    dependencies.assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      candidates,
      consumerLabel,
    )
    return resolvedAnswer
  }

  function resolveQuestionSurfaceAnswerContent<TMatch extends { question: string; answer: string }>(
    match: TMatch | undefined,
    missingMessage: string,
  ): ResolvedAnswerContent {
    if (!match) {
      throw new AnswerInterpretationError(missingMessage)
    }

    return {
      answer: match.answer,
      prompt: match.question,
    }
  }

  function resolveTopicSurfaceAnswer(match: string | undefined, missingMessage: string) {
    if (!match) {
      throw new AnswerInterpretationError(missingMessage)
    }

    return match
  }

  return {
    resolveAnswerContent,
  }
}
