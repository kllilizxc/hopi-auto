import { AnswerInterpretationError } from './answerInterpretationErrors'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
} from './answerInterpretationTypes'

export function createInterpretedSourceResponseState(
  sourceResponse: string | undefined,
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
): InterpretedSourceResponseState | undefined {
  if (!sourceResponseFormat) {
    return undefined
  }
  if (sourceResponseFormat === 'auto') {
    throw new AnswerInterpretationError(
      'sourceResponseFormat auto must be resolved before creating interpretation state.',
    )
  }

  return {
    sourceResponse,
    sourceResponseFormat,
    singlePendingConsumed: false,
    nextPendingClauseIndex: 0,
    nextPendingParagraphIndex: 0,
    nextPendingSentenceIndex: 0,
    nextPendingConjunctionIndex: 0,
    nextPendingAnswerSourceIndex: 0,
    nextOrderedItemIndex: 0,
    nextOrderedBlockIndex: 0,
    consumedMatchingRunIndexes: new Set<number>(),
    consumedMatchingOpeningRunIndexes: new Set<number>(),
    consumedMatchingClosingRunIndexes: new Set<number>(),
    consumedMatchingMiddleRunIndexes: new Set<number>(),
    consumedMatchingAnswerSourceIndexes: new Set<number>(),
    consumedLabeledSectionLabels: new Set<string>(),
    consumedInlineTopicLabels: new Set<string>(),
    consumedQuestionBlockIndexes: new Set<number>(),
    consumedQuestionClauseIndexes: new Set<number>(),
    consumedQuestionSpanIndexes: new Set<number>(),
    consumedQuestionMiddleSpanIndexes: new Set<number>(),
    consumedQuestionClosingSpanIndexes: new Set<number>(),
    consumedQuestionClosingBlockIndexes: new Set<number>(),
    consumedQuestionMiddleBlockIndexes: new Set<number>(),
    consumedTopicClauseIndexes: new Set<number>(),
    consumedTopicSentenceIndexes: new Set<number>(),
    consumedTopicSpanIndexes: new Set<number>(),
    consumedTopicMiddleSpanIndexes: new Set<number>(),
    consumedTopicClosingSpanIndexes: new Set<number>(),
    consumedTopicClosingBlockIndexes: new Set<number>(),
    consumedTopicParagraphIndexes: new Set<number>(),
    consumedTopicMiddleBlockIndexes: new Set<number>(),
    consumedTopicBlockIndexes: new Set<number>(),
  }
}
