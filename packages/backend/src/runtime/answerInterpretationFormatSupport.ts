import type { AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import type { InterpretableSourceResponseFormat } from './answerInterpretationTypes'

export class AutoSourceResponseTerminalError extends AnswerInterpretationError {}

type ConcreteInterpretableSourceResponseFormat = AnswerCaptureFormat

type TopicClauseUnit = {
  text: string
}

type PlanningAnswerLike = {
  summary: string
  answerKey?: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
}

type FollowThroughAnswerCarrier<TAnswer extends PlanningAnswerLike> = {
  answers?: TAnswer[]
}

type FollowThroughLike<TAnswer extends PlanningAnswerLike> =
  | (FollowThroughAnswerCarrier<TAnswer> & {
      kind: 'planning' | 'planning_batch'
      inferRemainingAnswers?: boolean
    })
  | (FollowThroughAnswerCarrier<TAnswer> & {
      kind: 'workflow_batch'
      inferRemainingAnswers?: boolean
      workflows: readonly FollowThroughAnswerCarrier<TAnswer>[]
    })

const AUTO_SOURCE_RESPONSE_FORMAT_PRIORITY: ConcreteInterpretableSourceResponseFormat[] = [
  'matching_answer_sources',
  'pending_answer_sources',
  'labeled_sections',
  'question_blocks',
  'question_closing_blocks',
  'question_middle_blocks',
  'question_spans',
  'question_middle_spans',
  'question_closing_spans',
  'question_clauses',
  'inline_topics',
  'topic_closing_blocks',
  'topic_middle_blocks',
  'topic_blocks',
  'topic_paragraphs',
  'topic_spans',
  'topic_middle_spans',
  'topic_closing_spans',
  'topic_sentences',
  'topic_clauses',
  'ordered_blocks',
  'ordered_items',
  'matching_runs',
  'matching_opening_runs',
  'matching_closing_runs',
  'matching_middle_runs',
  'single_pending',
  'pending_paragraphs',
  'pending_sentences',
  'pending_conjunctions',
  'pending_clauses',
]

const ANSWER_SOURCE_ONLY_FORMATS = new Set<ConcreteInterpretableSourceResponseFormat>([
  'pending_answer_sources',
  'matching_answer_sources',
])

const INFER_OPEN_DECISION_FORMATS = new Set<ConcreteInterpretableSourceResponseFormat>([
  'labeled_sections',
  'single_pending',
  'pending_clauses',
  'pending_paragraphs',
  'pending_sentences',
  'pending_conjunctions',
  'pending_answer_sources',
  'matching_answer_sources',
  'matching_runs',
  'matching_opening_runs',
  'matching_closing_runs',
  'matching_middle_runs',
  'ordered_items',
  'ordered_blocks',
  'question_blocks',
  'question_clauses',
  'question_spans',
  'question_middle_spans',
  'question_closing_spans',
  'question_closing_blocks',
  'question_middle_blocks',
  'inline_topics',
  'topic_clauses',
  'topic_sentences',
  'topic_spans',
  'topic_middle_spans',
  'topic_closing_spans',
  'topic_closing_blocks',
  'topic_paragraphs',
  'topic_middle_blocks',
  'topic_blocks',
])

const INFER_DECISION_TOPIC_FORMATS = new Set<ConcreteInterpretableSourceResponseFormat>([
  'pending_answer_sources',
  'matching_answer_sources',
  'labeled_sections',
  'inline_topics',
  'topic_clauses',
  'question_blocks',
  'question_clauses',
  'question_spans',
  'question_middle_spans',
  'question_closing_spans',
  'question_closing_blocks',
  'question_middle_blocks',
  'topic_sentences',
  'topic_spans',
  'topic_middle_spans',
  'topic_closing_spans',
  'topic_closing_blocks',
  'topic_paragraphs',
  'topic_middle_blocks',
  'topic_blocks',
])

const INFER_REMAINING_PLANNING_ANSWER_FORMATS = new Set<ConcreteInterpretableSourceResponseFormat>([
  'pending_answer_sources',
  'matching_answer_sources',
  'question_blocks',
  'question_clauses',
  'question_spans',
  'question_middle_spans',
  'question_closing_spans',
  'question_closing_blocks',
  'question_middle_blocks',
  'topic_clauses',
  'topic_sentences',
  'topic_spans',
  'topic_middle_spans',
  'topic_closing_spans',
  'topic_closing_blocks',
  'topic_paragraphs',
  'topic_middle_blocks',
  'topic_blocks',
])

export function createAnswerInterpretationFormatSupport<TAnswer extends PlanningAnswerLike>({
  buildPlanningAnswerSourceResponseCandidates,
  extractTrailingTopicSummary,
  parseGenericMatchingSourceResponseClauseUnits,
  parsePendingSourceResponseConjunctions,
  parseTopicSourceResponseSentences,
}: {
  buildPlanningAnswerSourceResponseCandidates: (answer: TAnswer) => string[]
  extractTrailingTopicSummary: (text: string) => string | undefined
  parseGenericMatchingSourceResponseClauseUnits: (text: string) => TopicClauseUnit[]
  parsePendingSourceResponseConjunctions: (text: string) => string[]
  parseTopicSourceResponseSentences: (text: string) => TopicClauseUnit[]
}) {
  function moveAutoSourceResponseFormatsBefore(
    candidates: ConcreteInterpretableSourceResponseFormat[],
    formatsToMove: ConcreteInterpretableSourceResponseFormat[],
    anchorFormats: ConcreteInterpretableSourceResponseFormat[],
  ) {
    const remaining = candidates.filter((candidate) => !formatsToMove.includes(candidate))
    const moved = candidates.filter((candidate) => formatsToMove.includes(candidate))
    if (moved.length === 0) {
      return candidates
    }

    const anchorIndex = remaining.findIndex((candidate) => anchorFormats.includes(candidate))
    if (anchorIndex === -1) {
      return candidates
    }

    return [...remaining.slice(0, anchorIndex), ...moved, ...remaining.slice(anchorIndex)]
  }

  function prioritizeAutoTopicClauseCandidates(
    candidates: ConcreteInterpretableSourceResponseFormat[],
    sourceResponse: string | undefined,
  ) {
    const shared = sourceResponse?.trim()
    if (!shared || parseTopicSourceResponseSentences(shared).length !== 1) {
      return candidates
    }

    const conjunctionSegments = parsePendingSourceResponseConjunctions(shared)
    if (conjunctionSegments.length > 1) {
      return moveAutoSourceResponseFormatsBefore(
        candidates,
        ['topic_clauses'],
        ['topic_spans', 'topic_middle_spans', 'topic_closing_spans', 'topic_sentences'],
      )
    }

    const clauses = parseGenericMatchingSourceResponseClauseUnits(shared)
    if (clauses.length <= 1) {
      return candidates
    }

    const everyClauseEndsWithTopic = clauses.every((clause) =>
      Boolean(extractTrailingTopicSummary(clause.text)),
    )
    if (everyClauseEndsWithTopic) {
      return candidates
    }

    return moveAutoSourceResponseFormatsBefore(
      candidates,
      ['topic_clauses'],
      ['topic_spans', 'topic_middle_spans', 'topic_closing_spans', 'topic_sentences'],
    )
  }

  function listAutoSourceResponseFormatCandidates(input: {
    hasSourceResponse: boolean
    hasAnswerSources: boolean
    needsExplicitAnswerInterpretation: boolean
    inferOpenDecisions?: boolean
    inferDecisionTopics?: boolean
    inferRemainingAnswers?: boolean
    sourceResponse?: string
  }) {
    if (!input.hasSourceResponse && !input.hasAnswerSources) {
      return []
    }

    if (
      !input.needsExplicitAnswerInterpretation &&
      !input.inferOpenDecisions &&
      !input.inferDecisionTopics &&
      !input.inferRemainingAnswers
    ) {
      return []
    }

    const candidates = AUTO_SOURCE_RESPONSE_FORMAT_PRIORITY.filter((format) => {
      if (!input.hasAnswerSources && ANSWER_SOURCE_ONLY_FORMATS.has(format)) {
        return false
      }
      if (!input.hasSourceResponse && !ANSWER_SOURCE_ONLY_FORMATS.has(format)) {
        return false
      }
      if (input.inferOpenDecisions && !INFER_OPEN_DECISION_FORMATS.has(format)) {
        return false
      }
      if (input.inferDecisionTopics && !INFER_DECISION_TOPIC_FORMATS.has(format)) {
        return false
      }
      if (input.inferRemainingAnswers && !INFER_REMAINING_PLANNING_ANSWER_FORMATS.has(format)) {
        return false
      }
      return true
    })

    return prioritizeAutoTopicClauseCandidates(candidates, input.sourceResponse)
  }

  function resolveAutoSourceResponseFormat(
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    candidates: readonly ConcreteInterpretableSourceResponseFormat[],
    attempt: (candidateFormat: ConcreteInterpretableSourceResponseFormat) => void,
    label: string,
  ): ConcreteInterpretableSourceResponseFormat | undefined {
    if (sourceResponseFormat !== 'auto') {
      return sourceResponseFormat
    }

    if (candidates.length === 0) {
      return undefined
    }

    let lastError: string | undefined
    for (const candidateFormat of candidates) {
      try {
        attempt(candidateFormat)
        return candidateFormat
      } catch (error) {
        if (error instanceof AutoSourceResponseTerminalError) {
          throw new AnswerInterpretationError(
            `sourceResponseFormat auto could not deterministically match ${label}. Provide an explicit sourceResponseFormat. Last probe error: ${error.message}`,
          )
        }
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat auto could not deterministically match ${label}. Provide an explicit sourceResponseFormat.${lastError ? ` Last probe error: ${lastError}` : ''}`,
    )
  }

  function listInterpretableFollowThroughAnswerSummaries(
    followThrough: FollowThroughLike<TAnswer> | undefined,
  ) {
    if (!followThrough) {
      return []
    }

    if (followThrough.kind === 'workflow_batch') {
      return [
        ...(followThrough.answers?.map((answer) => answer.summary) ?? []),
        ...followThrough.workflows.flatMap(
          (workflow) => workflow.answers?.map((answer) => answer.summary) ?? [],
        ),
      ]
    }

    return followThrough.answers?.map((answer) => answer.summary) ?? []
  }

  function listInterpretableFollowThroughAnswerCandidateGroups(
    followThrough: FollowThroughLike<TAnswer> | undefined,
  ) {
    if (!followThrough) {
      return []
    }

    if (followThrough.kind === 'workflow_batch') {
      return [
        ...(followThrough.answers?.map((answer) =>
          buildPlanningAnswerSourceResponseCandidates(answer),
        ) ?? []),
        ...followThrough.workflows.flatMap(
          (workflow) =>
            workflow.answers?.map((answer) =>
              buildPlanningAnswerSourceResponseCandidates(answer),
            ) ?? [],
        ),
      ]
    }

    return (
      followThrough.answers?.map((answer) => buildPlanningAnswerSourceResponseCandidates(answer)) ??
      []
    )
  }

  function followThroughInfersRemainingAnswers(
    followThrough: FollowThroughLike<TAnswer> | undefined,
  ) {
    if (!followThrough) {
      return false
    }
    return followThrough.inferRemainingAnswers === true
  }

  function supportsMixedRemainingAnswerSourceInference(
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  ) {
    return (
      sourceResponseFormat === 'pending_answer_sources' ||
      sourceResponseFormat === 'matching_answer_sources'
    )
  }

  function hasMixedRemainingAnswerSourceInference(input: {
    inferDecisionTopics?: boolean
    followThrough?: FollowThroughLike<TAnswer>
  }) {
    return Boolean(
      input.inferDecisionTopics && followThroughInfersRemainingAnswers(input.followThrough),
    )
  }

  function normalizeReservedAnswerCandidateGroups(
    reservedAnswerCandidates: string[] | string[][],
  ) {
    if (reservedAnswerCandidates.length === 0) {
      return []
    }

    const firstCandidate = reservedAnswerCandidates[0]
    if (Array.isArray(firstCandidate)) {
      return reservedAnswerCandidates as string[][]
    }

    return (reservedAnswerCandidates as string[]).map((summary) => [summary])
  }

  return {
    followThroughInfersRemainingAnswers,
    hasMixedRemainingAnswerSourceInference,
    listAutoSourceResponseFormatCandidates,
    listInterpretableFollowThroughAnswerCandidateGroups,
    listInterpretableFollowThroughAnswerSummaries,
    normalizeReservedAnswerCandidateGroups,
    resolveAutoSourceResponseFormat,
    supportsMixedRemainingAnswerSourceInference,
  }
}
