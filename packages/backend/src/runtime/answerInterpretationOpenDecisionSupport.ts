import {
  type InterpretableAnswerSourceInput,
  type RemainingAnswerSourceRoute,
  type ResolvedAnswerSourceEntry,
  createResolvedAnswerSources,
} from './answerInterpretationAnswerSourceSupport'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
} from './answerInterpretationTypes'

type MatchingAnswerSourceValueResolver = (
  matchingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
  consumerFamily?: RemainingAnswerSourceRoute,
) => string

type MatchingRunValueResolver = (
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => string

type QuestionSourceResponseSectionConsumer = (
  ...args: [
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    enforceDirectSourceResponseCompleteness: boolean,
  ]
) => unknown

type TopicSourceResponseSectionConsumer = (
  ...args: [
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    enforceDirectSourceResponseCompleteness: boolean,
    rejectMultipleInferredTopicSummariesInTopicUnits?: boolean,
  ]
) => unknown

interface OpenDecisionSurfaceNoMatchSupportDependencies<TDecision> {
  buildOpenDecisionSourceResponseCandidates: (decision: TDecision) => string[]
  consumeQuestionBlockSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionClauseSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionClosingBlockSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionClosingSpanSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionMiddleBlockSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionMiddleSpanSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionSpanSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeTopicBlockSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicClauseSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicClosingBlockSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicClosingSpanSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicMiddleBlockSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicMiddleSpanSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicParagraphSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicSentenceSourceResponseSection: TopicSourceResponseSectionConsumer
  consumeTopicSpanSourceResponseSection: TopicSourceResponseSectionConsumer
  getDecisionKey: (decision: TDecision) => string
  resolveMatchingAnswerSourceValue: MatchingAnswerSourceValueResolver
  resolveMatchingClosingRunSourceResponseValue: MatchingRunValueResolver
  resolveMatchingMiddleRunSourceResponseValue: MatchingRunValueResolver
  resolveMatchingOpeningRunSourceResponseValue: MatchingRunValueResolver
  resolveMatchingRunSourceResponseValue: MatchingRunValueResolver
}

export function createOpenDecisionSurfaceNoMatchSupport<TDecision>(
  dependencies: OpenDecisionSurfaceNoMatchSupportDependencies<TDecision>,
) {
  return function throwSpecificOpenDecisionSurfaceNoMatchError(
    openDecisions: readonly TDecision[],
    explicitDecisionKeys: Set<string>,
    sourceResponse: string | undefined,
    answerSources: InterpretableAnswerSourceInput[] | undefined,
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    const unresolvedOpenDecision = openDecisions.find(
      (decision) => !explicitDecisionKeys.has(dependencies.getDecisionKey(decision)),
    )
    if (!unresolvedOpenDecision) {
      return
    }

    const candidates =
      dependencies.buildOpenDecisionSourceResponseCandidates(unresolvedOpenDecision)
    const decisionKey = dependencies.getDecisionKey(unresolvedOpenDecision)
    const label = `open decision ${decisionKey}`

    if (sourceResponseFormat === 'matching_answer_sources') {
      const resolvedAnswerSources = createResolvedAnswerSources(answerSources, sourceResponse)
      dependencies.resolveMatchingAnswerSourceValue(
        resolvedAnswerSources?.entries,
        candidates,
        label,
        sourceResponseState,
        'decision',
      )
      return
    }

    if (sourceResponseFormat === 'matching_runs') {
      dependencies.resolveMatchingRunSourceResponseValue(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
      )
      return
    }

    if (sourceResponseFormat === 'matching_opening_runs') {
      dependencies.resolveMatchingOpeningRunSourceResponseValue(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
      )
      return
    }

    if (sourceResponseFormat === 'matching_closing_runs') {
      dependencies.resolveMatchingClosingRunSourceResponseValue(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
      )
      return
    }

    if (sourceResponseFormat === 'matching_middle_runs') {
      dependencies.resolveMatchingMiddleRunSourceResponseValue(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
      )
      return
    }

    if (sourceResponseFormat === 'question_blocks') {
      dependencies.consumeQuestionBlockSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'question_clauses') {
      dependencies.consumeQuestionClauseSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'question_spans') {
      dependencies.consumeQuestionSpanSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'question_middle_spans') {
      dependencies.consumeQuestionMiddleSpanSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'question_closing_spans') {
      dependencies.consumeQuestionClosingSpanSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'question_closing_blocks') {
      dependencies.consumeQuestionClosingBlockSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'question_middle_blocks') {
      dependencies.consumeQuestionMiddleBlockSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'topic_clauses') {
      dependencies.consumeTopicClauseSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
        false,
      )
      return
    }

    if (sourceResponseFormat === 'topic_sentences') {
      dependencies.consumeTopicSentenceSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
        false,
      )
      return
    }

    if (sourceResponseFormat === 'topic_spans') {
      dependencies.consumeTopicSpanSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'topic_middle_spans') {
      dependencies.consumeTopicMiddleSpanSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'topic_closing_spans') {
      dependencies.consumeTopicClosingSpanSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'topic_closing_blocks') {
      dependencies.consumeTopicClosingBlockSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'topic_paragraphs') {
      dependencies.consumeTopicParagraphSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
        false,
      )
      return
    }

    if (sourceResponseFormat === 'topic_middle_blocks') {
      dependencies.consumeTopicMiddleBlockSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
      return
    }

    if (sourceResponseFormat === 'topic_blocks') {
      dependencies.consumeTopicBlockSourceResponseSection(
        sourceResponse,
        candidates,
        label,
        sourceResponseState,
        true,
      )
    }
  }
}
