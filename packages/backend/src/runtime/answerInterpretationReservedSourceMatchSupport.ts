import { normalizeSourceResponseLabel } from './answerInterpretationStrings'
import type {
  LabeledSourceResponseSection,
  QuestionSourceResponseBlock,
  QuestionSourceResponseClosingBlock,
  QuestionSourceResponseClosingSpan,
  QuestionSourceResponseSpan,
  TopicSourceResponseBlock,
  TopicSourceResponseClosingBlock,
  TopicSourceResponseClosingSpan,
  TopicSourceResponseParagraph,
  TopicSourceResponseSentence,
  TopicSourceResponseSpan,
} from './answerInterpretationTypes'

interface ReservedSourceMatchSupportDependencies<TKnownDecision> {
  buildKnownDecisionSourceResponseCandidates: (decision: TKnownDecision) => string[]
  findMatchingQuestionBlockIndexes: (
    blocks: QuestionSourceResponseBlock[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingQuestionClosingBlockIndexes: (
    blocks: QuestionSourceResponseClosingBlock[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingQuestionClosingSpanIndexes: (
    spans: QuestionSourceResponseClosingSpan[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingQuestionSpanIndexes: (
    spans: QuestionSourceResponseSpan[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingTopicBlockIndexes: (
    blocks: TopicSourceResponseBlock[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingTopicClauseIndexes: (
    clauses: TopicSourceResponseSentence[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingTopicClosingBlockIndexes: (
    blocks: TopicSourceResponseClosingBlock[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingTopicClosingSpanIndexes: (
    spans: TopicSourceResponseClosingSpan[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingTopicParagraphIndexes: (
    paragraphs: TopicSourceResponseParagraph[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingTopicSentenceIndexes: (
    sentences: TopicSourceResponseSentence[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  findMatchingTopicSpanIndexes: (
    spans: TopicSourceResponseSpan[],
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  markConsumedMatchingIndexes: (
    consumedIndexes: Set<number>,
    matchingIndexes: number[],
  ) => void
  resolveContiguousMatchingIndexes: (
    matchingIndexes: number[],
    multipleMatchErrorMessage: string,
  ) => number[]
}

export function createAnswerInterpretationReservedSourceMatchSupport<TKnownDecision>(
  dependencies: ReservedSourceMatchSupportDependencies<TKnownDecision>,
) {
  function reserveMatchedLabeledSection(
    sectionsByLabel: Map<string, LabeledSourceResponseSection>,
    candidates: string[],
    reservedLabels: Set<string>,
  ) {
    for (const candidate of candidates) {
      const normalized = normalizeSourceResponseLabel(candidate)
      if (sectionsByLabel.has(normalized)) {
        reservedLabels.add(normalized)
        return
      }
    }
  }

  function reserveMatchedQuestionBlock(
    blocks: QuestionSourceResponseBlock[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingQuestionBlockIndexes(blocks, candidates, reservedIndexes),
        `Multiple question blocks matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedQuestionSpan(
    spans: QuestionSourceResponseSpan[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingQuestionSpanIndexes(spans, candidates, reservedIndexes),
        `Multiple question spans matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedQuestionClosingSpan(
    spans: QuestionSourceResponseClosingSpan[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingQuestionClosingSpanIndexes(spans, candidates, reservedIndexes),
        `Multiple question closing spans matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedQuestionClosingBlock(
    blocks: QuestionSourceResponseClosingBlock[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingQuestionClosingBlockIndexes(blocks, candidates, reservedIndexes),
        `Multiple question closing blocks matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedTopicSentence(
    sentences: TopicSourceResponseSentence[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingTopicSentenceIndexes(sentences, candidates, reservedIndexes),
        `Multiple topic sentences matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedTopicClause(
    clauses: TopicSourceResponseSentence[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingTopicClauseIndexes(clauses, candidates, reservedIndexes),
        `Multiple topic clauses matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedTopicSpan(
    spans: TopicSourceResponseSpan[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingTopicSpanIndexes(spans, candidates, reservedIndexes),
        `Multiple topic spans matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedTopicClosingSpan(
    spans: TopicSourceResponseClosingSpan[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingTopicClosingSpanIndexes(spans, candidates, reservedIndexes),
        `Multiple topic closing spans matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedTopicClosingBlock(
    blocks: TopicSourceResponseClosingBlock[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingTopicClosingBlockIndexes(blocks, candidates, reservedIndexes),
        `Multiple topic closing blocks matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedTopicParagraph(
    paragraphs: TopicSourceResponseParagraph[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingTopicParagraphIndexes(paragraphs, candidates, reservedIndexes),
        `Multiple topic paragraphs matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function reserveMatchedTopicBlock(
    blocks: TopicSourceResponseBlock[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) {
    dependencies.markConsumedMatchingIndexes(
      reservedIndexes,
      dependencies.resolveContiguousMatchingIndexes(
        dependencies.findMatchingTopicBlockIndexes(blocks, candidates, reservedIndexes),
        `Multiple topic blocks matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
      ),
    )
  }

  function findMatchingKnownDecisionsForQuestionBlock(
    block: QuestionSourceResponseBlock,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingQuestionBlockIndexes(
          [block],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForQuestionSpan(
    span: QuestionSourceResponseSpan,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingQuestionSpanIndexes(
          [span],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForQuestionClosingSpan(
    span: QuestionSourceResponseClosingSpan,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingQuestionClosingSpanIndexes(
          [span],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForQuestionClosingBlock(
    block: QuestionSourceResponseClosingBlock,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingQuestionClosingBlockIndexes(
          [block],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForTopicSentence(
    sentence: TopicSourceResponseSentence,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingTopicSentenceIndexes(
          [sentence],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForTopicClause(
    clause: TopicSourceResponseSentence,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingTopicClauseIndexes(
          [clause],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForTopicParagraph(
    paragraph: TopicSourceResponseParagraph,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingTopicParagraphIndexes(
          [paragraph],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForTopicSpan(
    span: TopicSourceResponseSpan,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingTopicSpanIndexes(
          [span],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForTopicClosingSpan(
    span: TopicSourceResponseClosingSpan,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingTopicClosingSpanIndexes(
          [span],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForTopicClosingBlock(
    block: TopicSourceResponseClosingBlock,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingTopicClosingBlockIndexes(
          [block],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  function findMatchingKnownDecisionsForTopicBlock(
    block: TopicSourceResponseBlock,
    knownDecisions: TKnownDecision[],
  ) {
    return knownDecisions.filter(
      (decision) =>
        dependencies.findMatchingTopicBlockIndexes(
          [block],
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
          new Set<number>(),
        ).length > 0,
    )
  }

  return {
    findMatchingKnownDecisionsForQuestionBlock,
    findMatchingKnownDecisionsForQuestionClosingBlock,
    findMatchingKnownDecisionsForQuestionClosingSpan,
    findMatchingKnownDecisionsForQuestionSpan,
    findMatchingKnownDecisionsForTopicBlock,
    findMatchingKnownDecisionsForTopicClause,
    findMatchingKnownDecisionsForTopicClosingBlock,
    findMatchingKnownDecisionsForTopicClosingSpan,
    findMatchingKnownDecisionsForTopicParagraph,
    findMatchingKnownDecisionsForTopicSentence,
    findMatchingKnownDecisionsForTopicSpan,
    reserveMatchedLabeledSection,
    reserveMatchedQuestionBlock,
    reserveMatchedQuestionClosingBlock,
    reserveMatchedQuestionClosingSpan,
    reserveMatchedQuestionSpan,
    reserveMatchedTopicBlock,
    reserveMatchedTopicClause,
    reserveMatchedTopicClosingBlock,
    reserveMatchedTopicClosingSpan,
    reserveMatchedTopicParagraph,
    reserveMatchedTopicSentence,
    reserveMatchedTopicSpan,
  }
}
