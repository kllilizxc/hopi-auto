import { synthesizeCanonicalPromptFromSummary } from '../domain/canonicalPrompt'
import type { GoalPlanningRequestAnswer } from '../storage/planningRequestStore'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
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

type PreparedQuestionBlockSurface = {
  kind: 'question_blocks' | 'question_middle_blocks'
  units: QuestionSourceResponseBlock[]
  consumedIndexes: Set<number>
}

type PreparedQuestionSpanSurface = {
  kind: 'question_clauses' | 'question_spans' | 'question_middle_spans'
  units: QuestionSourceResponseSpan[]
  consumedIndexes: Set<number>
}

type PreparedQuestionClosingSpanSurface = {
  kind: 'question_closing_spans'
  units: QuestionSourceResponseClosingSpan[]
  consumedIndexes: Set<number>
}

type PreparedQuestionClosingBlockSurface = {
  kind: 'question_closing_blocks'
  units: QuestionSourceResponseClosingBlock[]
  consumedIndexes: Set<number>
}

type PreparedTopicSentenceSurface = {
  kind: 'topic_clauses' | 'topic_sentences'
  units: TopicSourceResponseSentence[]
  consumedIndexes: Set<number>
}

type PreparedTopicSpanSurface = {
  kind: 'topic_spans' | 'topic_middle_spans'
  units: TopicSourceResponseSpan[]
  consumedIndexes: Set<number>
}

type PreparedTopicClosingSpanSurface = {
  kind: 'topic_closing_spans'
  units: TopicSourceResponseClosingSpan[]
  consumedIndexes: Set<number>
}

type PreparedTopicClosingBlockSurface = {
  kind: 'topic_closing_blocks'
  units: TopicSourceResponseClosingBlock[]
  consumedIndexes: Set<number>
}

type PreparedTopicParagraphSurface = {
  kind: 'topic_paragraphs'
  units: TopicSourceResponseParagraph[]
  consumedIndexes: Set<number>
}

type PreparedTopicBlockSurface = {
  kind: 'topic_middle_blocks' | 'topic_blocks'
  units: TopicSourceResponseBlock[]
  consumedIndexes: Set<number>
}

export type PreparedRemainingPlanningSurface =
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

interface RemainingPlanningSurfaceSupportDependencies {
  assertTopicAnswerTextDoesNotContainQuestionAuthority: (
    text: string,
    unitLabel: string,
  ) => void
  inferSummaryFromQuestionLabel: (question: string) => string
  inferTopicSummaryFromTopicBlock: (block: TopicSourceResponseBlock) => string
  inferTopicSummaryFromTopicClosingBlock: (block: TopicSourceResponseClosingBlock) => string
  inferTopicSummaryFromTopicClosingSpan: (span: TopicSourceResponseClosingSpan) => string
  inferTopicSummaryFromTopicParagraph: (paragraph: string) => string
  inferTopicSummaryFromTopicSentence: (sentence: string) => string
  inferTopicSummaryFromTopicSpan: (span: TopicSourceResponseSpan) => string
  parseRequiredQuestionSourceResponseBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => QuestionSourceResponseBlock[]
  parseRequiredQuestionSourceResponseClauses: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => QuestionSourceResponseSpan[]
  parseRequiredQuestionSourceResponseClosingBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => QuestionSourceResponseClosingBlock[]
  parseRequiredQuestionSourceResponseClosingSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => QuestionSourceResponseClosingSpan[]
  parseRequiredQuestionSourceResponseMiddleBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => QuestionSourceResponseBlock[]
  parseRequiredQuestionSourceResponseMiddleSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => QuestionSourceResponseSpan[]
  parseRequiredQuestionSourceResponseSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => QuestionSourceResponseSpan[]
  parseRequiredTopicSourceResponseBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => TopicSourceResponseBlock[]
  parseRequiredTopicSourceResponseClauses: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => TopicSourceResponseSentence[]
  parseRequiredTopicSourceResponseClosingBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => TopicSourceResponseClosingBlock[]
  parseRequiredTopicSourceResponseClosingSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => TopicSourceResponseClosingSpan[]
  parseRequiredTopicSourceResponseMiddleBlocks: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => TopicSourceResponseBlock[]
  parseRequiredTopicSourceResponseMiddleSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => TopicSourceResponseSpan[]
  parseRequiredTopicSourceResponseParagraphs: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => TopicSourceResponseParagraph[]
  parseRequiredTopicSourceResponseSentences: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => TopicSourceResponseSentence[]
  parseRequiredTopicSourceResponseSpans: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState: InterpretedSourceResponseState,
  ) => TopicSourceResponseSpan[]
}

export function createAnswerInterpretationRemainingPlanningSurfaceSupport(
  dependencies: RemainingPlanningSurfaceSupportDependencies,
) {
  function prepareRemainingPlanningSurface(
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponse: string | undefined,
    interpretationState: InterpretedSourceResponseState | undefined,
  ): PreparedRemainingPlanningSurface {
    if (!interpretationState) {
      throw new AnswerInterpretationError(
        'followThrough.inferRemainingAnswers requires a resolved sourceResponseFormat.',
      )
    }

    switch (sourceResponseFormat) {
      case 'question_blocks':
        return {
          kind: 'question_blocks',
          units: dependencies.parseRequiredQuestionSourceResponseBlocks(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedQuestionBlockIndexes,
        }
      case 'question_clauses':
        return {
          kind: 'question_clauses',
          units: dependencies.parseRequiredQuestionSourceResponseClauses(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedQuestionClauseIndexes,
        }
      case 'question_spans':
        return {
          kind: 'question_spans',
          units: dependencies.parseRequiredQuestionSourceResponseSpans(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedQuestionSpanIndexes,
        }
      case 'question_middle_spans':
        return {
          kind: 'question_middle_spans',
          units: dependencies.parseRequiredQuestionSourceResponseMiddleSpans(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedQuestionMiddleSpanIndexes,
        }
      case 'question_closing_spans':
        return {
          kind: 'question_closing_spans',
          units: dependencies.parseRequiredQuestionSourceResponseClosingSpans(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedQuestionClosingSpanIndexes,
        }
      case 'question_closing_blocks':
        return {
          kind: 'question_closing_blocks',
          units: dependencies.parseRequiredQuestionSourceResponseClosingBlocks(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedQuestionClosingBlockIndexes,
        }
      case 'question_middle_blocks':
        return {
          kind: 'question_middle_blocks',
          units: dependencies.parseRequiredQuestionSourceResponseMiddleBlocks(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedQuestionMiddleBlockIndexes,
        }
      case 'topic_clauses':
        return {
          kind: 'topic_clauses',
          units: dependencies.parseRequiredTopicSourceResponseClauses(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedTopicClauseIndexes,
        }
      case 'topic_sentences':
        return {
          kind: 'topic_sentences',
          units: dependencies.parseRequiredTopicSourceResponseSentences(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedTopicSentenceIndexes,
        }
      case 'topic_spans':
        return {
          kind: 'topic_spans',
          units: dependencies.parseRequiredTopicSourceResponseSpans(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedTopicSpanIndexes,
        }
      case 'topic_middle_spans':
        return {
          kind: 'topic_middle_spans',
          units: dependencies.parseRequiredTopicSourceResponseMiddleSpans(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedTopicMiddleSpanIndexes,
        }
      case 'topic_closing_spans':
        return {
          kind: 'topic_closing_spans',
          units: dependencies.parseRequiredTopicSourceResponseClosingSpans(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedTopicClosingSpanIndexes,
        }
      case 'topic_closing_blocks':
        return {
          kind: 'topic_closing_blocks',
          units: dependencies.parseRequiredTopicSourceResponseClosingBlocks(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedTopicClosingBlockIndexes,
        }
      case 'topic_paragraphs':
        return {
          kind: 'topic_paragraphs',
          units: dependencies.parseRequiredTopicSourceResponseParagraphs(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedTopicParagraphIndexes,
        }
      case 'topic_middle_blocks':
        return {
          kind: 'topic_middle_blocks',
          units: dependencies.parseRequiredTopicSourceResponseMiddleBlocks(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedTopicMiddleBlockIndexes,
        }
      case 'topic_blocks':
        return {
          kind: 'topic_blocks',
          units: dependencies.parseRequiredTopicSourceResponseBlocks(
            sourceResponse,
            'followThrough.inferRemainingAnswers',
            interpretationState,
          ),
          consumedIndexes: interpretationState.consumedTopicBlockIndexes,
        }
      default:
        throw new AnswerInterpretationError(
          `followThrough.inferRemainingAnswers surface support does not handle sourceResponseFormat "${sourceResponseFormat ?? 'undefined'}".`,
        )
    }
  }

  function materializeRemainingPlanningSurfaceAnswers(
    preparedSurface: PreparedRemainingPlanningSurface,
  ): GoalPlanningRequestAnswer[] {
    switch (preparedSurface.kind) {
      case 'question_blocks':
      case 'question_middle_blocks':
        return materializeQuestionPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
        )
      case 'question_clauses':
      case 'question_spans':
      case 'question_middle_spans':
        return materializeQuestionPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
        )
      case 'question_closing_spans':
        return materializeQuestionPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
        )
      case 'question_closing_blocks':
        return materializeQuestionPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
        )
      case 'topic_clauses':
        return materializeTopicPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
          (clause) => dependencies.inferTopicSummaryFromTopicSentence(clause.text),
          'Topic clause',
        )
      case 'topic_sentences':
        return materializeTopicPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
          (sentence) => dependencies.inferTopicSummaryFromTopicSentence(sentence.text),
          'Topic sentence',
        )
      case 'topic_spans':
      case 'topic_middle_spans':
        return materializeTopicPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
          dependencies.inferTopicSummaryFromTopicSpan,
          preparedSurface.kind === 'topic_spans' ? 'Topic span' : 'Topic middle span',
        )
      case 'topic_closing_spans':
        return materializeTopicPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
          dependencies.inferTopicSummaryFromTopicClosingSpan,
          'Topic closing span',
        )
      case 'topic_closing_blocks':
        return materializeTopicPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
          dependencies.inferTopicSummaryFromTopicClosingBlock,
          'Topic closing block',
        )
      case 'topic_paragraphs':
        return materializeTopicPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
          (paragraph) => dependencies.inferTopicSummaryFromTopicParagraph(paragraph.text),
          'Topic paragraph',
        )
      case 'topic_middle_blocks':
      case 'topic_blocks':
        return materializeTopicPlanningAnswers(
          preparedSurface.units,
          preparedSurface.consumedIndexes,
          dependencies.inferTopicSummaryFromTopicBlock,
          preparedSurface.kind === 'topic_blocks' ? 'Topic block' : 'Topic middle block',
        )
    }
  }

  function materializeQuestionPlanningAnswers<TUnit extends { question: string; answer: string }>(
    units: TUnit[],
    consumedIndexes: Set<number>,
  ) {
    const answers: GoalPlanningRequestAnswer[] = []

    for (const [index, unit] of units.entries()) {
      if (consumedIndexes.has(index)) {
        continue
      }

      consumedIndexes.add(index)
      answers.push({
        summary: dependencies.inferSummaryFromQuestionLabel(unit.question),
        prompt: unit.question,
        answer: unit.answer,
      })
    }

    return answers
  }

  function materializeTopicPlanningAnswers<TUnit extends { text: string }>(
    units: TUnit[],
    consumedIndexes: Set<number>,
    inferSummary: (unit: TUnit) => string,
    authorityUnitLabel: string,
  ) {
    const answers: GoalPlanningRequestAnswer[] = []

    for (const [index, unit] of units.entries()) {
      if (consumedIndexes.has(index)) {
        continue
      }

      consumedIndexes.add(index)
      dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(unit.text, authorityUnitLabel)
      const summary = inferSummary(unit)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        answer: unit.text,
      })
    }

    return answers
  }

  return {
    materializeRemainingPlanningSurfaceAnswers,
    prepareRemainingPlanningSurface,
  }
}
