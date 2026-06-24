import { synthesizeCanonicalPromptFromSummary } from '../domain/canonicalPrompt'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import {
  buildDecisionAnswerSourceResponseCandidates,
  buildOpenDecisionSourceResponseCandidates,
  createKnownDecisionsBySummaryLookup,
} from './answerInterpretationStrings'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
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

interface DecisionTopicSurfaceCandidateLike {
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  decisionKey?: string
  taskRef?: string
}

interface DecisionTopicSurfaceOpenDecisionLike extends DecisionTopicSurfaceCandidateLike {
  decisionKey: string
}

export interface MaterializedDecisionTopicSurfaceAnswer {
  summary: string
  prompt?: string
  decisionKey?: string
  taskRef?: string
  answer: string
}

type PreparedLabeledSectionSurface = {
  kind: 'labeled_sections' | 'inline_topics'
  sectionsByLabel: Map<string, LabeledSourceResponseSection>
  reservedLabels: Set<string>
  consumedLabels?: Set<string>
}

type PreparedQuestionBlockSurface = {
  kind: 'question_blocks' | 'question_middle_blocks'
  units: QuestionSourceResponseBlock[]
  reservedIndexes: Set<number>
}

type PreparedQuestionSpanSurface = {
  kind: 'question_clauses' | 'question_spans' | 'question_middle_spans'
  units: QuestionSourceResponseSpan[]
  reservedIndexes: Set<number>
}

type PreparedQuestionClosingSpanSurface = {
  kind: 'question_closing_spans'
  units: QuestionSourceResponseClosingSpan[]
  reservedIndexes: Set<number>
}

type PreparedQuestionClosingBlockSurface = {
  kind: 'question_closing_blocks'
  units: QuestionSourceResponseClosingBlock[]
  reservedIndexes: Set<number>
}

type PreparedTopicSentenceSurface = {
  kind: 'topic_clauses' | 'topic_sentences'
  units: TopicSourceResponseSentence[]
  reservedIndexes: Set<number>
}

type PreparedTopicSpanSurface = {
  kind: 'topic_spans' | 'topic_middle_spans'
  units: TopicSourceResponseSpan[]
  reservedIndexes: Set<number>
}

type PreparedTopicClosingSpanSurface = {
  kind: 'topic_closing_spans'
  units: TopicSourceResponseClosingSpan[]
  reservedIndexes: Set<number>
}

type PreparedTopicClosingBlockSurface = {
  kind: 'topic_closing_blocks'
  units: TopicSourceResponseClosingBlock[]
  reservedIndexes: Set<number>
}

type PreparedTopicParagraphSurface = {
  kind: 'topic_paragraphs'
  units: TopicSourceResponseParagraph[]
  reservedIndexes: Set<number>
}

type PreparedTopicBlockSurface = {
  kind: 'topic_middle_blocks' | 'topic_blocks'
  units: TopicSourceResponseBlock[]
  reservedIndexes: Set<number>
}

export type PreparedDecisionTopicSurface =
  | PreparedLabeledSectionSurface
  | PreparedQuestionBlockSurface
  | PreparedQuestionSpanSurface
  | PreparedQuestionClosingSpanSurface
  | PreparedQuestionClosingBlockSurface
  | PreparedTopicSentenceSurface
  | PreparedTopicSpanSurface
  | PreparedTopicClosingSpanSurface
  | PreparedTopicClosingBlockSurface
  | PreparedTopicParagraphSurface
  | PreparedTopicBlockSurface

interface DecisionTopicSurfaceSupportDependencies<
  TKnownDecision extends DecisionTopicSurfaceCandidateLike,
> {
  assertLabeledValueAuthorityMatchesLabel: (
    label: string,
    value: string,
    unitLabel: string,
    valueLabel: string,
  ) => void
  assertTopicAnswerTextDoesNotContainQuestionAuthority: (
    text: string,
    unitLabel: string,
  ) => void
  findMatchingKnownDecisionsForQuestionBlock: (
    block: QuestionSourceResponseBlock,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForQuestionClosingBlock: (
    block: QuestionSourceResponseClosingBlock,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForQuestionClosingSpan: (
    span: QuestionSourceResponseClosingSpan,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForQuestionSpan: (
    span: QuestionSourceResponseSpan,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForTopicBlock: (
    block: TopicSourceResponseBlock,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForTopicClause: (
    clause: TopicSourceResponseSentence,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForTopicClosingBlock: (
    block: TopicSourceResponseClosingBlock,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForTopicClosingSpan: (
    span: TopicSourceResponseClosingSpan,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForTopicParagraph: (
    paragraph: TopicSourceResponseParagraph,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForTopicSentence: (
    sentence: TopicSourceResponseSentence,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  findMatchingKnownDecisionsForTopicSpan: (
    span: TopicSourceResponseSpan,
    knownDecisions: TKnownDecision[],
  ) => TKnownDecision[]
  inferSummaryFromQuestionLabel: (question: string) => string
  inferTopicSummaryFromTopicBlock: (block: TopicSourceResponseBlock) => string
  inferTopicSummaryFromTopicClosingBlock: (block: TopicSourceResponseClosingBlock) => string
  inferTopicSummaryFromTopicClosingSpan: (span: TopicSourceResponseClosingSpan) => string
  inferTopicSummaryFromTopicParagraph: (paragraph: string) => string
  inferTopicSummaryFromTopicSentence: (sentence: string) => string
  inferTopicSummaryFromTopicSpan: (span: TopicSourceResponseSpan) => string
  parseRequiredInlineTopicSections: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => Map<string, LabeledSourceResponseSection>
  parseRequiredLabeledSourceResponseSections: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => Map<string, LabeledSourceResponseSection>
  parseRequiredQuestionSourceResponseBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => QuestionSourceResponseBlock[]
  parseRequiredQuestionSourceResponseClauses: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => QuestionSourceResponseSpan[]
  parseRequiredQuestionSourceResponseClosingBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => QuestionSourceResponseClosingBlock[]
  parseRequiredQuestionSourceResponseClosingSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => QuestionSourceResponseClosingSpan[]
  parseRequiredQuestionSourceResponseMiddleBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => QuestionSourceResponseBlock[]
  parseRequiredQuestionSourceResponseMiddleSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => QuestionSourceResponseSpan[]
  parseRequiredQuestionSourceResponseSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => QuestionSourceResponseSpan[]
  parseRequiredTopicSourceResponseBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => TopicSourceResponseBlock[]
  parseRequiredTopicSourceResponseClauses: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => TopicSourceResponseSentence[]
  parseRequiredTopicSourceResponseClosingBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => TopicSourceResponseClosingBlock[]
  parseRequiredTopicSourceResponseClosingSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => TopicSourceResponseClosingSpan[]
  parseRequiredTopicSourceResponseMiddleBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => TopicSourceResponseBlock[]
  parseRequiredTopicSourceResponseMiddleSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => TopicSourceResponseSpan[]
  parseRequiredTopicSourceResponseParagraphs: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => TopicSourceResponseParagraph[]
  parseRequiredTopicSourceResponseSentences: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => TopicSourceResponseSentence[]
  parseRequiredTopicSourceResponseSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => TopicSourceResponseSpan[]
  reserveMatchedLabeledSection: (
    sectionsByLabel: Map<string, LabeledSourceResponseSection>,
    candidates: string[],
    reservedLabels: Set<string>,
  ) => void
  reserveMatchedQuestionBlock: (
    blocks: QuestionSourceResponseBlock[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedQuestionClosingBlock: (
    blocks: QuestionSourceResponseClosingBlock[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedQuestionClosingSpan: (
    spans: QuestionSourceResponseClosingSpan[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedQuestionSpan: (
    spans: QuestionSourceResponseSpan[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedTopicBlock: (
    blocks: TopicSourceResponseBlock[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedTopicClause: (
    clauses: TopicSourceResponseSentence[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedTopicClosingBlock: (
    blocks: TopicSourceResponseClosingBlock[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedTopicClosingSpan: (
    spans: TopicSourceResponseClosingSpan[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedTopicParagraph: (
    paragraphs: TopicSourceResponseParagraph[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedTopicSentence: (
    sentences: TopicSourceResponseSentence[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
  reserveMatchedTopicSpan: (
    spans: TopicSourceResponseSpan[],
    candidates: string[],
    reservedIndexes: Set<number>,
  ) => void
}

export function createAnswerInterpretationDecisionTopicSurfaceSupport<
  TKnownDecision extends DecisionTopicSurfaceCandidateLike,
>(dependencies: DecisionTopicSurfaceSupportDependencies<TKnownDecision>) {
  function prepareDecisionTopicSurface(
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponse: string | undefined,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ): PreparedDecisionTopicSurface {
    switch (sourceResponseFormat) {
      case 'labeled_sections':
        return {
          kind: 'labeled_sections',
          sectionsByLabel: dependencies.parseRequiredLabeledSourceResponseSections(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedLabels: new Set<string>(),
          consumedLabels: sourceResponseState?.consumedLabeledSectionLabels,
        }
      case 'inline_topics':
        return {
          kind: 'inline_topics',
          sectionsByLabel: dependencies.parseRequiredInlineTopicSections(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedLabels: new Set<string>(),
          consumedLabels: sourceResponseState?.consumedInlineTopicLabels,
        }
      case 'question_blocks':
        return {
          kind: 'question_blocks',
          units: dependencies.parseRequiredQuestionSourceResponseBlocks(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'question_clauses':
        return {
          kind: 'question_clauses',
          units: dependencies.parseRequiredQuestionSourceResponseClauses(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'question_spans':
        return {
          kind: 'question_spans',
          units: dependencies.parseRequiredQuestionSourceResponseSpans(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'question_middle_spans':
        return {
          kind: 'question_middle_spans',
          units: dependencies.parseRequiredQuestionSourceResponseMiddleSpans(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'question_closing_spans':
        return {
          kind: 'question_closing_spans',
          units: dependencies.parseRequiredQuestionSourceResponseClosingSpans(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'question_closing_blocks':
        return {
          kind: 'question_closing_blocks',
          units: dependencies.parseRequiredQuestionSourceResponseClosingBlocks(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'question_middle_blocks':
        return {
          kind: 'question_middle_blocks',
          units: dependencies.parseRequiredQuestionSourceResponseMiddleBlocks(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'topic_clauses':
        return {
          kind: 'topic_clauses',
          units: dependencies.parseRequiredTopicSourceResponseClauses(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'topic_sentences':
        return {
          kind: 'topic_sentences',
          units: dependencies.parseRequiredTopicSourceResponseSentences(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'topic_spans':
        return {
          kind: 'topic_spans',
          units: dependencies.parseRequiredTopicSourceResponseSpans(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'topic_middle_spans':
        return {
          kind: 'topic_middle_spans',
          units: dependencies.parseRequiredTopicSourceResponseMiddleSpans(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'topic_closing_spans':
        return {
          kind: 'topic_closing_spans',
          units: dependencies.parseRequiredTopicSourceResponseClosingSpans(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'topic_closing_blocks':
        return {
          kind: 'topic_closing_blocks',
          units: dependencies.parseRequiredTopicSourceResponseClosingBlocks(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'topic_paragraphs':
        return {
          kind: 'topic_paragraphs',
          units: dependencies.parseRequiredTopicSourceResponseParagraphs(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'topic_middle_blocks':
        return {
          kind: 'topic_middle_blocks',
          units: dependencies.parseRequiredTopicSourceResponseMiddleBlocks(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      case 'topic_blocks':
        return {
          kind: 'topic_blocks',
          units: dependencies.parseRequiredTopicSourceResponseBlocks(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          ),
          reservedIndexes: new Set<number>(),
        }
      default:
        throw new AnswerInterpretationError(
          `inferDecisionTopics surface support does not handle sourceResponseFormat "${sourceResponseFormat ?? 'undefined'}".`,
        )
    }
  }

  function reservePreparedDecisionTopicSurfaceCandidates(
    preparedSurface: PreparedDecisionTopicSurface,
    explicitAnswers: DecisionTopicSurfaceCandidateLike[],
    openDecisions: DecisionTopicSurfaceOpenDecisionLike[],
    inferOpenDecisions: boolean,
    reservedAnswerCandidateGroups: string[][],
  ) {
    for (const answer of explicitAnswers) {
      reserveSurfaceCandidates(
        preparedSurface,
        buildDecisionAnswerSourceResponseCandidates(answer),
      )
    }

    if (inferOpenDecisions) {
      const explicitDecisionKeys = new Set(
        explicitAnswers.flatMap((answer) => (answer.decisionKey ? [answer.decisionKey] : [])),
      )
      for (const decision of openDecisions) {
        if (explicitDecisionKeys.has(decision.decisionKey)) {
          continue
        }

        reserveSurfaceCandidates(
          preparedSurface,
          buildOpenDecisionSourceResponseCandidates(decision),
        )
      }
    }

    for (const candidates of reservedAnswerCandidateGroups) {
      reserveSurfaceCandidates(preparedSurface, candidates)
    }
  }

  function materializePreparedDecisionTopicSurfaceAnswers(
    preparedSurface: PreparedDecisionTopicSurface,
    knownDecisions: TKnownDecision[],
  ): MaterializedDecisionTopicSurfaceAnswer[] {
    switch (preparedSurface.kind) {
      case 'question_blocks':
        return materializeQuestionSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForQuestionBlock,
          'question block',
        )
      case 'question_clauses':
        return materializeQuestionSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForQuestionSpan,
          'question clause',
        )
      case 'question_spans':
        return materializeQuestionSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForQuestionSpan,
          'question span',
        )
      case 'question_middle_spans':
        return materializeQuestionSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForQuestionSpan,
          'question middle span',
        )
      case 'question_closing_spans':
        return materializeQuestionSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForQuestionClosingSpan,
          'question closing span',
        )
      case 'question_closing_blocks':
        return materializeQuestionSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForQuestionClosingBlock,
          'question closing block',
        )
      case 'question_middle_blocks':
        return materializeQuestionSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForQuestionBlock,
          'question middle block',
        )
      case 'topic_clauses':
        return materializeTopicSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForTopicClause,
          (clause) => dependencies.inferTopicSummaryFromTopicSentence(clause.text),
          (clause) => clause.text,
          'topic clause',
          'Topic clause',
        )
      case 'topic_sentences':
        return materializeTopicSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForTopicSentence,
          (sentence) => dependencies.inferTopicSummaryFromTopicSentence(sentence.text),
          (sentence) => sentence.text,
          'topic sentence',
          'Topic sentence',
        )
      case 'topic_spans':
        return materializeTopicSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForTopicSpan,
          dependencies.inferTopicSummaryFromTopicSpan,
          (span) => span.anchorText,
          'topic span',
          'Topic span',
        )
      case 'topic_middle_spans':
        return materializeTopicSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForTopicSpan,
          dependencies.inferTopicSummaryFromTopicSpan,
          (span) => span.anchorText,
          'topic middle span',
          'Topic middle span',
        )
      case 'topic_closing_spans':
        return materializeTopicSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForTopicClosingSpan,
          dependencies.inferTopicSummaryFromTopicClosingSpan,
          (span) => span.closingText,
          'topic closing span',
          'Topic closing span',
        )
      case 'topic_closing_blocks':
        return materializeTopicSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForTopicClosingBlock,
          dependencies.inferTopicSummaryFromTopicClosingBlock,
          (block) => block.closingText,
          'topic closing block',
          'Topic closing block',
        )
      case 'topic_paragraphs':
        return materializeTopicSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForTopicParagraph,
          (paragraph) => dependencies.inferTopicSummaryFromTopicParagraph(paragraph.text),
          (paragraph) => paragraph.text,
          'topic paragraph',
          'Topic paragraph',
        )
      case 'topic_middle_blocks':
        return materializeTopicSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForTopicBlock,
          dependencies.inferTopicSummaryFromTopicBlock,
          (block) => block.anchorText,
          'topic middle block',
          'Topic middle block',
        )
      case 'topic_blocks':
        return materializeTopicSurfaceAnswers(
          preparedSurface.units,
          preparedSurface.reservedIndexes,
          knownDecisions,
          dependencies.findMatchingKnownDecisionsForTopicBlock,
          dependencies.inferTopicSummaryFromTopicBlock,
          (block) => block.anchorText,
          'topic block',
          'Topic block',
        )
      case 'labeled_sections':
      case 'inline_topics':
        return materializeLabeledSectionAnswers(preparedSurface, knownDecisions)
    }
  }

  function reserveSurfaceCandidates(
    preparedSurface: PreparedDecisionTopicSurface,
    candidates: string[],
  ) {
    switch (preparedSurface.kind) {
      case 'question_blocks':
      case 'question_middle_blocks':
        dependencies.reserveMatchedQuestionBlock(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'question_clauses':
      case 'question_spans':
      case 'question_middle_spans':
        dependencies.reserveMatchedQuestionSpan(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'question_closing_spans':
        dependencies.reserveMatchedQuestionClosingSpan(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'question_closing_blocks':
        dependencies.reserveMatchedQuestionClosingBlock(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'topic_clauses':
        dependencies.reserveMatchedTopicClause(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'topic_sentences':
        dependencies.reserveMatchedTopicSentence(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'topic_spans':
      case 'topic_middle_spans':
        dependencies.reserveMatchedTopicSpan(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'topic_closing_spans':
        dependencies.reserveMatchedTopicClosingSpan(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'topic_closing_blocks':
        dependencies.reserveMatchedTopicClosingBlock(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'topic_paragraphs':
        dependencies.reserveMatchedTopicParagraph(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'topic_middle_blocks':
      case 'topic_blocks':
        dependencies.reserveMatchedTopicBlock(
          preparedSurface.units,
          candidates,
          preparedSurface.reservedIndexes,
        )
        return
      case 'labeled_sections':
      case 'inline_topics':
        dependencies.reserveMatchedLabeledSection(
          preparedSurface.sectionsByLabel,
          candidates,
          preparedSurface.reservedLabels,
        )
        return
    }
  }

  function resolveSingleMatchingKnownDecision(
    matchingKnownDecisions: TKnownDecision[],
    multipleMatchErrorMessage: string,
  ) {
    if (matchingKnownDecisions.length > 1) {
      throw new AnswerInterpretationError(multipleMatchErrorMessage)
    }

    return matchingKnownDecisions[0]
  }

  function buildQuestionMaterializedAnswer(
    matchingKnownDecision: TKnownDecision | undefined,
    question: string,
    answer: string,
  ): MaterializedDecisionTopicSurfaceAnswer {
    return {
      summary:
        matchingKnownDecision?.summary ?? dependencies.inferSummaryFromQuestionLabel(question),
      prompt: matchingKnownDecision?.prompt ?? question,
      decisionKey: matchingKnownDecision?.decisionKey,
      taskRef: matchingKnownDecision?.taskRef,
      answer,
    }
  }

  function buildTopicMaterializedAnswer(
    matchingKnownDecision: TKnownDecision | undefined,
    summary: string,
    answer: string,
  ): MaterializedDecisionTopicSurfaceAnswer {
    return {
      summary,
      ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
      decisionKey: matchingKnownDecision?.decisionKey,
      taskRef: matchingKnownDecision?.taskRef,
      answer,
    }
  }

  function materializeQuestionSurfaceAnswers<TUnit extends { question: string; answer: string }>(
    units: TUnit[],
    reservedIndexes: Set<number>,
    knownDecisions: TKnownDecision[],
    findMatchingKnownDecisions: (unit: TUnit, knownDecisions: TKnownDecision[]) => TKnownDecision[],
    unitLabel: string,
  ) {
    const materializedAnswers: MaterializedDecisionTopicSurfaceAnswer[] = []

    for (const [index, unit] of units.entries()) {
      if (reservedIndexes.has(index)) {
        continue
      }

      const matchingKnownDecision = resolveSingleMatchingKnownDecision(
        findMatchingKnownDecisions(unit, knownDecisions),
        `Multiple existing decisions match inferred ${unitLabel} "${unit.question}".`,
      )

      materializedAnswers.push(
        buildQuestionMaterializedAnswer(matchingKnownDecision, unit.question, unit.answer),
      )
    }

    return materializedAnswers
  }

  function materializeTopicSurfaceAnswers<TUnit extends { text: string }>(
    units: TUnit[],
    reservedIndexes: Set<number>,
    knownDecisions: TKnownDecision[],
    findMatchingKnownDecisions: (unit: TUnit, knownDecisions: TKnownDecision[]) => TKnownDecision[],
    inferSummary: (unit: TUnit) => string,
    formatMultipleMatchValue: (unit: TUnit) => string,
    unitLabel: string,
    authorityUnitLabel: string,
  ) {
    const materializedAnswers: MaterializedDecisionTopicSurfaceAnswer[] = []

    for (const [index, unit] of units.entries()) {
      if (reservedIndexes.has(index)) {
        continue
      }

      const matchingKnownDecision = resolveSingleMatchingKnownDecision(
        findMatchingKnownDecisions(unit, knownDecisions),
        `Multiple existing decisions match inferred ${unitLabel} "${formatMultipleMatchValue(unit)}".`,
      )

      dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(unit.text, authorityUnitLabel)
      const summary = matchingKnownDecision?.summary ?? inferSummary(unit)
      materializedAnswers.push(
        buildTopicMaterializedAnswer(matchingKnownDecision, summary, unit.text),
      )
    }

    return materializedAnswers
  }

  function materializeLabeledSectionAnswers(
    preparedSurface: PreparedLabeledSectionSurface,
    knownDecisions: TKnownDecision[],
  ) {
    const materializedAnswers: MaterializedDecisionTopicSurfaceAnswer[] = []
    const knownDecisionsBySummary = createKnownDecisionsBySummaryLookup(knownDecisions)
    const labeledSectionUnitLabel =
      preparedSurface.kind === 'inline_topics' ? 'Inline topic clause' : 'Labeled section'
    const labeledSectionValueLabel =
      preparedSurface.kind === 'inline_topics' ? 'answer text' : 'value text'

    for (const [normalizedLabel, section] of preparedSurface.sectionsByLabel) {
      if (preparedSurface.reservedLabels.has(normalizedLabel)) {
        continue
      }

      dependencies.assertLabeledValueAuthorityMatchesLabel(
        section.label,
        section.value,
        labeledSectionUnitLabel,
        labeledSectionValueLabel,
      )
      preparedSurface.consumedLabels?.add(normalizedLabel)

      const matchingKnownDecision = resolveSingleMatchingKnownDecision(
        knownDecisionsBySummary.get(normalizedLabel) ?? [],
        `Multiple existing decisions match inferred label "${section.label}".`,
      )
      const summary = matchingKnownDecision?.summary ?? section.label
      materializedAnswers.push(
        buildTopicMaterializedAnswer(matchingKnownDecision, summary, section.value),
      )
    }

    return materializedAnswers
  }

  return {
    materializePreparedDecisionTopicSurfaceAnswers,
    prepareDecisionTopicSurface,
    reservePreparedDecisionTopicSurfaceCandidates,
  }
}
