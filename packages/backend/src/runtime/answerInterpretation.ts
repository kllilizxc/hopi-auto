import { ANSWER_CAPTURE_FORMATS, type AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import { synthesizeCanonicalPromptFromSummary } from '../domain/canonicalPrompt'
import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
} from '../storage/planningRequestStore'
import type { GoalPlanningBatchEntryInput } from './planningRequest'

export class AnswerInterpretationError extends Error {}
class AutoSourceResponseTerminalError extends AnswerInterpretationError {}

export const INTERPRETABLE_SOURCE_RESPONSE_FORMATS = ['auto', ...ANSWER_CAPTURE_FORMATS] as const

export type InterpretableSourceResponseFormat =
  (typeof INTERPRETABLE_SOURCE_RESPONSE_FORMATS)[number]

type ConcreteInterpretableSourceResponseFormat = AnswerCaptureFormat

export interface InterpretedSourceResponseState {
  sourceResponse?: string
  sourceResponseFormat: InterpretableSourceResponseFormat
  labeledSections?: Map<string, LabeledSourceResponseSection>
  inlineTopics?: Map<string, LabeledSourceResponseSection>
  questionBlocks?: QuestionSourceResponseBlock[]
  questionClauses?: QuestionSourceResponseSpan[]
  questionSpans?: QuestionSourceResponseSpan[]
  questionMiddleSpans?: QuestionSourceResponseSpan[]
  questionClosingSpans?: QuestionSourceResponseClosingSpan[]
  questionClosingBlocks?: QuestionSourceResponseClosingBlock[]
  questionMiddleBlocks?: QuestionSourceResponseBlock[]
  questionAnchorCandidateGroups?: string[][]
  questionAnchorCandidateLookup?: Map<string, number>
  topicClauses?: TopicSourceResponseSentence[]
  topicSentences?: TopicSourceResponseSentence[]
  topicSpans?: TopicSourceResponseSpan[]
  topicMiddleSpans?: TopicSourceResponseSpan[]
  topicClosingSpans?: TopicSourceResponseClosingSpan[]
  topicClosingBlocks?: TopicSourceResponseClosingBlock[]
  topicParagraphs?: TopicSourceResponseParagraph[]
  topicMiddleBlocks?: TopicSourceResponseBlock[]
  topicBlocks?: TopicSourceResponseBlock[]
  topicAnchorCandidateLabels?: Set<string>
  matchingRunCandidateGroups?: string[][]
  matchingRunCandidateLookup?: Map<string, number>
  matchingRuns?: MatchingSourceResponseRun[]
  matchingOpeningRuns?: MatchingSourceResponseRun[]
  matchingClosingRuns?: MatchingSourceResponseRun[]
  matchingMiddleRuns?: MatchingSourceResponseRun[]
  orderedItems?: string[]
  orderedBlocks?: string[]
  singlePendingConsumed: boolean
  pendingClauses?: string[]
  pendingParagraphs?: string[]
  pendingSentences?: string[]
  pendingConjunctions?: string[]
  pendingAnswerSourceEntries?: ResolvedAnswerSourceEntry[]
  matchingAnswerSourceEntries?: ResolvedAnswerSourceEntry[]
  nextOrderedItemIndex: number
  nextOrderedBlockIndex: number
  nextPendingClauseIndex: number
  nextPendingParagraphIndex: number
  nextPendingSentenceIndex: number
  nextPendingConjunctionIndex: number
  nextPendingAnswerSourceIndex: number
  consumedMatchingRunIndexes: Set<number>
  consumedMatchingOpeningRunIndexes: Set<number>
  consumedMatchingClosingRunIndexes: Set<number>
  consumedMatchingMiddleRunIndexes: Set<number>
  consumedMatchingAnswerSourceIndexes: Set<number>
  consumedLabeledSectionLabels: Set<string>
  consumedInlineTopicLabels: Set<string>
  consumedQuestionBlockIndexes: Set<number>
  consumedQuestionClauseIndexes: Set<number>
  consumedQuestionSpanIndexes: Set<number>
  consumedQuestionMiddleSpanIndexes: Set<number>
  consumedQuestionClosingSpanIndexes: Set<number>
  consumedQuestionClosingBlockIndexes: Set<number>
  consumedQuestionMiddleBlockIndexes: Set<number>
  consumedTopicClauseIndexes: Set<number>
  consumedTopicSentenceIndexes: Set<number>
  consumedTopicSpanIndexes: Set<number>
  consumedTopicMiddleSpanIndexes: Set<number>
  consumedTopicClosingSpanIndexes: Set<number>
  consumedTopicClosingBlockIndexes: Set<number>
  consumedTopicParagraphIndexes: Set<number>
  consumedTopicMiddleBlockIndexes: Set<number>
  consumedTopicBlockIndexes: Set<number>
}

interface LabeledSourceResponseSection {
  label: string
  value: string
  sourceLineIndex?: number
  sourceClauseIndex?: number
}

interface TopicSourceResponseSentence {
  text: string
  normalizedText: string
}

interface TopicSourceResponseParagraph {
  text: string
  normalizedText: string
}

interface TopicSourceResponseSpan {
  text: string
  anchorText: string
  normalizedAnchorLabel: string
}

interface TopicSourceResponseClosingSpan {
  text: string
  closingText: string
  normalizedClosingLabel: string
}

interface TopicSourceResponseClosingBlock {
  text: string
  closingText: string
  normalizedClosingLabel: string
}

interface QuestionSourceResponseBlock {
  question: string
  normalizedQuestionText: string
  normalizedQuestionCoreText: string
  answer: string
}

interface QuestionSourceResponseSpan {
  question: string
  normalizedQuestionText: string
  normalizedQuestionCoreText: string
  answer: string
}

interface QuestionSourceResponseClosingSpan {
  question: string
  normalizedQuestionText: string
  normalizedQuestionCoreText: string
  answer: string
}

interface QuestionSourceResponseClosingBlock {
  question: string
  normalizedQuestionText: string
  normalizedQuestionCoreText: string
  answer: string
}

interface TopicSourceResponseBlock {
  text: string
  anchorText: string
  normalizedAnchorLabel: string
}

interface MatchingSourceResponseRun {
  text: string
  candidateGroupIndex: number
}

interface EmbeddedMatchingRunToken {
  normalizedText: string
  start: number
  end: number
}

interface EmbeddedMatchingRunAnchor {
  candidateGroupIndex: number
  startTokenIndex: number
  endTokenIndex: number
  startOriginal: number
  endOriginal: number
}

interface EmbeddedTopicAnchor {
  normalizedLabel: string
  startTokenIndex: number
  endTokenIndex: number
  startOriginal: number
  endOriginal: number
}

interface CanonicalQuestionAnchorMatch {
  rawQuestion: string
  canonicalPrompt: string
  endTokenIndex: number
  endOriginal: number
}

interface ResolvedAnswerContent {
  answer: string
  prompt?: string
  captureFormat?: AnswerCaptureFormat
}

interface ResolvedAnswerSourceEntry {
  key: string
  sourceKeys: string[]
  sourceGroupKey?: string
  answer: string
  route?: RemainingAnswerSourceRoute
  decisionKey?: string
  answerKey?: string
  summaryKey?: string
  summary?: string
  prompt?: string
  matchHints?: string[]
  candidates: string[]
}

interface ResolvedAnswerSources {
  byKey: Map<string, string>
  byGroupKey: Map<string, string>
  entries: ResolvedAnswerSourceEntry[]
}

interface RemainingAnswerSourceGroupDescriptor {
  key: string
  label: string
}

interface GroupedAnswerSourceEntry {
  indexes: number[]
  entry: ResolvedAnswerSourceEntry
}

type RemainingAnswerSourceRoute = 'decision' | 'planning'

interface RoutedGroupedAnswerSourceEntry extends GroupedAnswerSourceEntry {
  route: RemainingAnswerSourceRoute
}

interface PendingAnswerSourceConsumerDescriptor {
  family: RemainingAnswerSourceRoute
  keys: string[]
}

const TOPIC_SUMMARY_VERB_PATTERN =
  '(?:should|will|must|can|could|would|is|are|was|were|uses|use|means|requires|starts)'
const TOPIC_SUMMARY_PREFIX_PATTERN = '(?:for|about|regarding|on)'

type InterpretableAnswerSourceMetadata = {
  answerSourceKey: string
  sourceGroupKey?: string
  route?: RemainingAnswerSourceRoute
  decisionKey?: string
  answerKey?: string
  summaryKey?: string
  summary?: string
  prompt?: string
  matchHints?: string[]
}

export type InterpretableAnswerSource =
  | (InterpretableAnswerSourceMetadata & {
      answer: string
    })
  | (InterpretableAnswerSourceMetadata & {
      sourceExcerpt: string
      sourceOccurrence?: number
    })

export interface InterpretablePlanningAnswer {
  summary: string
  answerKey?: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

export interface InterpretableDecisionAnswerEntryInput {
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  decisionKey?: string
  taskRef?: string
  answer?: string
  sourceExcerpt?: string
  sourceOccurrence?: number
  answerSourceKey?: string
  answerSourceGroupKey?: string
}

export interface InterpretableOpenDecision {
  decisionKey: string
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  taskRef?: string
}

export interface InterpretableKnownDecision {
  decisionKey: string
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  taskRef?: string
}

export interface MaterializedInterpretedDecisionAnswer {
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  captureFormat?: AnswerCaptureFormat
  decisionKey?: string
  taskRef?: string
  answer: string
}

export interface InterpretableDecisionPlanningFollowThroughInput {
  kind: 'planning'
  inferRemainingAnswers?: boolean
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: InterpretablePlanningAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
}

export interface InterpretableDecisionPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
  inferRemainingAnswers?: boolean
  answers?: InterpretablePlanningAnswer[]
  requests: GoalPlanningBatchEntryInput[]
}

export interface InterpretableDecisionWorkflowPlanningFollowThroughInput {
  kind: 'planning'
  workflowTaskKey?: string
  blockedByWorkflowKeys?: string[]
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: InterpretablePlanningAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
}

export interface InterpretableDecisionWorkflowPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
  blockedByWorkflowKeys?: string[]
  answers?: InterpretablePlanningAnswer[]
  requests?: GoalPlanningBatchEntryInput[]
}

export type InterpretableDecisionWorkflowLeafFollowThroughInput =
  | InterpretableDecisionWorkflowPlanningFollowThroughInput
  | InterpretableDecisionWorkflowPlanningBatchFollowThroughInput

export interface InterpretableDecisionWorkflowBatchFollowThroughInput {
  kind: 'workflow_batch'
  workflowKey?: string
  reuseTaskRef?: string
  reuseGroupKey?: string
  inferRemainingAnswers?: boolean
  answers?: InterpretablePlanningAnswer[]
  workflows: InterpretableDecisionWorkflowLeafFollowThroughInput[]
}

export type InterpretableDecisionLeafFollowThroughInput =
  | InterpretableDecisionPlanningFollowThroughInput
  | InterpretableDecisionPlanningBatchFollowThroughInput

export type InterpretableDecisionFollowThroughInput =
  | InterpretableDecisionLeafFollowThroughInput
  | InterpretableDecisionWorkflowBatchFollowThroughInput

type InterpretablePlanningAnswerCarrier = {
  answers?: InterpretablePlanningAnswer[]
}

type MaterializedPlanningAnswerCarrier<T extends InterpretablePlanningAnswerCarrier> = Omit<
  T,
  'answers'
> & {
  answers: GoalPlanningRequestAnswer[] | undefined
  resolvedSourceResponseFormat?: ConcreteInterpretableSourceResponseFormat
}

type InterpretablePlanningWorkflowLeafCarrier = {
  kind: 'planning' | 'planning_batch'
  answers?: InterpretablePlanningAnswer[]
}

type MaterializedPlanningWorkflowLeafCarrier<T extends InterpretablePlanningWorkflowLeafCarrier> =
  Omit<T, 'answers'> & {
    answers: GoalPlanningRequestAnswer[] | undefined
  }

type MaterializedPlanningWorkflowBatchCarrier<
  T extends {
    answers?: InterpretablePlanningAnswer[]
    workflows: readonly InterpretablePlanningWorkflowLeafCarrier[]
  },
> = Omit<T, 'answers' | 'workflows'> & {
  answers: GoalPlanningRequestAnswer[] | undefined
  resolvedSourceResponseFormat?: ConcreteInterpretableSourceResponseFormat
  workflows: {
    [K in keyof T['workflows']]: T['workflows'][K] extends InterpretablePlanningWorkflowLeafCarrier
      ? MaterializedPlanningWorkflowLeafCarrier<T['workflows'][K]>
      : never
  }
}

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

export function listAutoSourceResponseFormatCandidates(input: {
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
    return moveAutoSourceResponseFormatsBefore(candidates, ['topic_clauses'], [
      'topic_spans',
      'topic_middle_spans',
      'topic_closing_spans',
      'topic_sentences',
    ])
  }

  const clauses = parseGenericMatchingSourceResponseClauseUnits(shared)
  if (clauses.length <= 1) {
    return candidates
  }

  const everyClauseEndsWithTopic = clauses.every((clause) => Boolean(extractTrailingTopicSummary(clause.text)))
  if (everyClauseEndsWithTopic) {
    return candidates
  }

  return moveAutoSourceResponseFormatsBefore(candidates, ['topic_clauses'], [
    'topic_spans',
    'topic_middle_spans',
    'topic_closing_spans',
    'topic_sentences',
  ])
}

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

  return [
    ...remaining.slice(0, anchorIndex),
    ...moved,
    ...remaining.slice(anchorIndex),
  ]
}

export function resolveAutoSourceResponseFormat(
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

export function listInterpretableFollowThroughAnswerSummaries(
  followThrough: InterpretableDecisionFollowThroughInput | undefined,
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

export function listInterpretableFollowThroughAnswerCandidateGroups(
  followThrough: InterpretableDecisionFollowThroughInput | undefined,
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
          workflow.answers?.map((answer) => buildPlanningAnswerSourceResponseCandidates(answer)) ??
          [],
      ),
    ]
  }

  return (
    followThrough.answers?.map((answer) => buildPlanningAnswerSourceResponseCandidates(answer)) ??
    []
  )
}

export function followThroughInfersRemainingAnswers(
  followThrough: InterpretableDecisionFollowThroughInput | undefined,
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
  followThrough?: InterpretableDecisionFollowThroughInput
}) {
  return Boolean(
    input.inferDecisionTopics && followThroughInfersRemainingAnswers(input.followThrough),
  )
}

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

function assertAutoSourceResponseFormatCompleteness(input: {
  sourceResponse?: string
  answerSources?: InterpretableAnswerSource[]
  sourceResponseFormat: ConcreteInterpretableSourceResponseFormat
  sourceResponseState: InterpretedSourceResponseState | undefined
  inferDecisionTopics?: boolean
  inferRemainingAnswers?: boolean
}) {
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
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'pending clauses',
        state.nextPendingClauseIndex,
        parseRequiredPendingSourceResponseClauses(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'pending_paragraphs':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'pending paragraphs',
        state.nextPendingParagraphIndex,
        parseRequiredPendingSourceResponseParagraphs(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'pending_sentences':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'pending sentences',
        state.nextPendingSentenceIndex,
        parseRequiredPendingSourceResponseSentences(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'pending_conjunctions':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'pending conjunction segments',
        state.nextPendingConjunctionIndex,
        parseRequiredPendingSourceResponseConjunctions(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'pending_answer_sources': {
      if (input.inferDecisionTopics && !input.inferRemainingAnswers) {
        return
      }
      const entries = parseRequiredPendingAnswerSourceEntries(
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
      const entries = parseRequiredMatchingAnswerSourceEntries(
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
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'matching runs',
        state.consumedMatchingRunIndexes.size,
        parseMatchingSourceResponseRuns(input.sourceResponse, 'sourceResponseFormat auto', state)
          .length,
      )
      return
    case 'matching_opening_runs':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'matching opening runs',
        state.consumedMatchingOpeningRunIndexes.size,
        parseMatchingOpeningSourceResponseRuns(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'matching_closing_runs':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'matching closing runs',
        state.consumedMatchingClosingRunIndexes.size,
        parseMatchingClosingSourceResponseRuns(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'matching_middle_runs':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'matching middle runs',
        state.consumedMatchingMiddleRunIndexes.size,
        parseMatchingMiddleSourceResponseRuns(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'ordered_items':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'ordered items',
        state.nextOrderedItemIndex,
        parseRequiredOrderedSourceResponseItems(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'ordered_blocks':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'ordered blocks',
        state.nextOrderedBlockIndex,
        parseRequiredOrderedSourceResponseBlocks(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'question_blocks':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'question blocks',
        state.consumedQuestionBlockIndexes.size,
        parseRequiredQuestionSourceResponseBlocks(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'question_clauses':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'question clauses',
        state.consumedQuestionClauseIndexes.size,
        parseRequiredQuestionSourceResponseClauses(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'question_spans':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'question spans',
        state.consumedQuestionSpanIndexes.size,
        parseRequiredQuestionSourceResponseSpans(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'question_middle_spans':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'question middle spans',
        state.consumedQuestionMiddleSpanIndexes.size,
        parseRequiredQuestionSourceResponseMiddleSpans(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'question_closing_spans':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'question closing spans',
        state.consumedQuestionClosingSpanIndexes.size,
        parseRequiredQuestionSourceResponseClosingSpans(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'question_closing_blocks':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'question closing blocks',
        state.consumedQuestionClosingBlockIndexes.size,
        parseRequiredQuestionSourceResponseClosingBlocks(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'question_middle_blocks':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'question middle blocks',
        state.consumedQuestionMiddleBlockIndexes.size,
        parseRequiredQuestionSourceResponseMiddleBlocks(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'topic_clauses':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'topic clauses',
        state.consumedTopicClauseIndexes.size,
        parseRequiredTopicSourceResponseClauses(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'topic_sentences':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'topic sentences',
        state.consumedTopicSentenceIndexes.size,
        parseRequiredTopicSourceResponseSentences(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'topic_spans':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'topic spans',
        state.consumedTopicSpanIndexes.size,
        parseRequiredTopicSourceResponseSpans(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'topic_middle_spans':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'topic middle spans',
        state.consumedTopicMiddleSpanIndexes.size,
        parseRequiredTopicSourceResponseMiddleSpans(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'topic_closing_spans':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'topic closing spans',
        state.consumedTopicClosingSpanIndexes.size,
        parseRequiredTopicSourceResponseClosingSpans(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'topic_closing_blocks':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'topic closing blocks',
        state.consumedTopicClosingBlockIndexes.size,
        parseRequiredTopicSourceResponseClosingBlocks(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'topic_paragraphs':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'topic paragraphs',
        state.consumedTopicParagraphIndexes.size,
        parseRequiredTopicSourceResponseParagraphs(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'topic_middle_blocks':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'topic middle blocks',
        state.consumedTopicMiddleBlockIndexes.size,
        parseRequiredTopicSourceResponseMiddleBlocks(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'topic_blocks':
      if (input.inferDecisionTopics) {
        return
      }
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'topic blocks',
        state.consumedTopicBlockIndexes.size,
        parseRequiredTopicSourceResponseBlocks(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).length,
      )
      return
    case 'labeled_sections':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'labeled sections',
        state.consumedLabeledSectionLabels.size,
        parseRequiredLabeledSourceResponseSections(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ).size,
      )
      assertAutoLabeledSectionsDidNotSkipStandaloneQuestionAuthority(
        input.sourceResponse,
        parseRequiredLabeledSourceResponseSections(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ),
      )
      assertAutoLabeledSectionsDidNotSkipStandaloneTopicAuthority(
        input.sourceResponse,
        parseRequiredLabeledSourceResponseSections(
          input.sourceResponse,
          'sourceResponseFormat auto',
          state,
        ),
      )
      return
    case 'inline_topics':
      assertAutoSourceResponseUnitCompleteness(
        input.sourceResponseFormat,
        'inline topic clauses',
        state.consumedInlineTopicLabels.size,
        parseRequiredInlineTopicSections(input.sourceResponse, 'sourceResponseFormat auto', state)
          .size,
      )
      return
  }
}

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

function parseRequiredQuestionSourceResponseUnits<T>(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseFormat:
    | 'question_blocks'
    | 'question_clauses'
    | 'question_spans'
    | 'question_middle_spans'
    | 'question_closing_spans'
    | 'question_closing_blocks'
    | 'question_middle_blocks',
  cached: T[] | undefined,
  parse: (sourceResponse: string) => T[],
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

function assertDirectLabelFamilySourceResponseCompleteness(input: {
  sourceResponse?: string
  sourceResponseFormat?: InterpretableSourceResponseFormat
  sourceResponseState?: InterpretedSourceResponseState
  label: string
  enforceDirectLabeledSectionCompleteness?: boolean
}) {
  if (
    input.enforceDirectLabeledSectionCompleteness !== false &&
    input.sourceResponseFormat === 'labeled_sections' &&
    (input.sourceResponseState?.consumedLabeledSectionLabels.size ?? 0) > 0
  ) {
    const labeledSections = parseRequiredLabeledSourceResponseSections(
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
    assertDirectLabeledSectionsDidNotSkipStandaloneQuestionAuthority(
      input.sourceResponse,
      labeledSections,
    )
    assertDirectLabeledSectionsDidNotSkipStandaloneTopicAuthority(
      input.sourceResponse,
      labeledSections,
    )
  }

  if (
    input.sourceResponseFormat === 'inline_topics' &&
    (input.sourceResponseState?.consumedInlineTopicLabels.size ?? 0) > 0
  ) {
    const inlineTopics = parseRequiredInlineTopicSections(
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
    assertDirectInlineTopicsDidNotSkipStandaloneQuestionAuthority(
      input.sourceResponse,
      inlineTopics,
      input.sourceResponseState?.consumedInlineTopicLabels,
    )
    assertDirectInlineTopicsDidNotSkipStandaloneTopicAuthority(
      input.sourceResponse,
      inlineTopics,
      input.sourceResponseState?.consumedInlineTopicLabels,
    )
  }
}

function assertDirectQuestionAndTopicSourceResponseCompleteness(input: {
  sourceResponse?: string
  sourceResponseFormat?: InterpretableSourceResponseFormat
  sourceResponseState?: InterpretedSourceResponseState
  label: string
}) {
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
        parseQuestionSourceResponseBlocks,
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
        parseQuestionSourceResponseClauses,
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
        parseQuestionSourceResponseSpans,
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
        parseQuestionSourceResponseMiddleSpans,
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
        parseQuestionSourceResponseClosingSpans,
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
        parseQuestionSourceResponseClosingBlocks,
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
        parseQuestionSourceResponseMiddleBlocks,
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
      parseRequiredTopicSourceResponseClauses(
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
      parseRequiredTopicSourceResponseSentences(
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
      parseRequiredTopicSourceResponseSpans(
        input.sourceResponse,
        input.label,
        state,
      ).length,
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
      parseRequiredTopicSourceResponseMiddleSpans(
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
      parseRequiredTopicSourceResponseClosingSpans(
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
      parseRequiredTopicSourceResponseClosingBlocks(
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
      parseRequiredTopicSourceResponseParagraphs(
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
      parseRequiredTopicSourceResponseMiddleBlocks(
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
      parseRequiredTopicSourceResponseBlocks(
        input.sourceResponse,
        input.label,
        state,
      ).length,
    )
  }
}

function assertDirectOrderedSourceResponseCompleteness(input: {
  sourceResponse?: string
  sourceResponseFormat?: InterpretableSourceResponseFormat
  sourceResponseState?: InterpretedSourceResponseState
  label: string
}) {
  if (
    input.sourceResponseFormat === 'ordered_items' &&
    (input.sourceResponseState?.nextOrderedItemIndex ?? 0) > 0
  ) {
    assertDirectSourceResponseUnitCompleteness(
      'ordered_items',
      'ordered items',
      input.sourceResponseState?.nextOrderedItemIndex ?? 0,
      parseRequiredOrderedSourceResponseItems(
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
      parseRequiredOrderedSourceResponseBlocks(
        input.sourceResponse,
        input.label,
        input.sourceResponseState,
      ).length,
    )
  }
}

function assertDirectPendingSourceResponseCompleteness(input: {
  sourceResponse?: string
  sourceResponseFormat?: InterpretableSourceResponseFormat
  sourceResponseState?: InterpretedSourceResponseState
  label: string
}) {
  if (
    input.sourceResponseFormat === 'pending_clauses' &&
    (input.sourceResponseState?.nextPendingClauseIndex ?? 0) > 0
  ) {
    assertDirectSourceResponseUnitCompleteness(
      'pending_clauses',
      'pending clauses',
      input.sourceResponseState?.nextPendingClauseIndex ?? 0,
      parseRequiredPendingSourceResponseClauses(
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
      parseRequiredPendingSourceResponseParagraphs(
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
      parseRequiredPendingSourceResponseSentences(
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
      parseRequiredPendingSourceResponseConjunctions(
        input.sourceResponse,
        input.label,
        input.sourceResponseState,
      ).length,
    )
  }
}

function assertDirectAnswerSourceFamilySourceResponseCompleteness(input: {
  sourceResponse?: string
  answerSources?: InterpretableAnswerSource[]
  sourceResponseFormat?: InterpretableSourceResponseFormat
  sourceResponseState?: InterpretedSourceResponseState
  label: string
}) {
  if (
    input.sourceResponseFormat === 'pending_answer_sources' &&
    (input.sourceResponseState?.nextPendingAnswerSourceIndex ?? 0) > 0
  ) {
    const entries = parseRequiredPendingAnswerSourceEntries(
      createResolvedAnswerSources(input.answerSources, input.sourceResponse)?.entries,
      input.label,
      input.sourceResponseState,
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
    const entries = parseRequiredMatchingAnswerSourceEntries(
      createResolvedAnswerSources(input.answerSources, input.sourceResponse)?.entries,
      input.label,
      input.sourceResponseState,
    )
    assertDirectSourceResponseUnitCompleteness(
      'matching_answer_sources',
      'matching answer sources',
      input.sourceResponseState?.consumedMatchingAnswerSourceIndexes.size ?? 0,
      entries.length,
    )
  }
}

function assertDirectMatchingRunSourceResponseCompleteness(input: {
  sourceResponse?: string
  sourceResponseFormat?: InterpretableSourceResponseFormat
  sourceResponseState?: InterpretedSourceResponseState
  label: string
}) {
  if (
    input.sourceResponseFormat === 'matching_runs' &&
    (input.sourceResponseState?.consumedMatchingRunIndexes.size ?? 0) > 0
  ) {
    assertDirectSourceResponseUnitCompleteness(
      'matching_runs',
      'matching runs',
      input.sourceResponseState?.consumedMatchingRunIndexes.size ?? 0,
      parseMatchingSourceResponseRuns(
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
      parseMatchingOpeningSourceResponseRuns(
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
      parseMatchingClosingSourceResponseRuns(
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
      parseMatchingMiddleSourceResponseRuns(
        input.sourceResponse,
        input.label,
        input.sourceResponseState,
      ).length,
    )
  }
}

function assertNoUnusedExplicitlyRoutedAnswerSources(input: {
  sourceResponse?: string
  answerSources?: InterpretableAnswerSource[]
  sourceResponseFormat?: InterpretableSourceResponseFormat
  sourceResponseState?: InterpretedSourceResponseState
  label: string
}) {
  const state = input.sourceResponseState
  if (!state) {
    return
  }

  if (input.sourceResponseFormat === 'pending_answer_sources') {
    const entries = parseRequiredPendingAnswerSourceEntries(
      createResolvedAnswerSources(input.answerSources, input.sourceResponse)?.entries,
      input.label,
      state,
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
    const entries = parseRequiredMatchingAnswerSourceEntries(
      createResolvedAnswerSources(input.answerSources, input.sourceResponse)?.entries,
      input.label,
      state,
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
    if (
      parsedInlineTopic &&
      inlineTopicClauseUsesExplicitLabelValueSeparator(chunk)
    ) {
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
        assertExplicitLabelTextDoesNotContainAuthority(
          parsed.label,
          'Inline topic clause label',
        )
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
    listAdditionalVerbalInlineTopicAuthoritiesAlongsideSeparatorStyleInlineTopics(
      sourceResponse,
    )
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
      return hasExplicitText(
        sourceResponseState.topicMiddleSpans?.map((span) => span.anchorText),
      )
    case 'topic_closing_spans':
      return hasExplicitText(
        sourceResponseState.topicClosingSpans?.map((span) => span.closingText),
      )
    default:
      return false
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
    if (autoInlineTopicsShouldYieldToExplicitTopicAuthority(sourceResponseState)) {
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
      orderedBlocksCollapsedMarkedOrderedItems(
        sourceResponseState?.sourceResponse,
        sourceResponseState?.orderedBlocks,
      )
    )
  }
  if (sourceResponseFormat === 'question_blocks') {
    return autoQuestionSurfaceEstablishedExplicitAuthority(
      sourceResponseFormat,
      sourceResponseState,
    )
  }
  if (sourceResponseFormat === 'question_clauses') {
    return (
      autoQuestionSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState) ||
      sourceResponseHasQuestionSentenceAuthority(sourceResponseState?.sourceResponse)
    )
  }
  if (sourceResponseFormat === 'question_spans') {
    return autoQuestionSurfaceEstablishedExplicitAuthority(
      sourceResponseFormat,
      sourceResponseState,
    )
  }
  if (sourceResponseFormat === 'question_middle_spans') {
    return autoQuestionSurfaceEstablishedExplicitAuthority(
      sourceResponseFormat,
      sourceResponseState,
    )
  }
  if (sourceResponseFormat === 'question_closing_spans') {
    return autoQuestionSurfaceEstablishedExplicitAuthority(
      sourceResponseFormat,
      sourceResponseState,
    )
  }
  if (sourceResponseFormat === 'question_closing_blocks') {
    return autoQuestionSurfaceEstablishedExplicitAuthority(
      sourceResponseFormat,
      sourceResponseState,
    )
  }
  if (sourceResponseFormat === 'question_middle_blocks') {
    return autoQuestionSurfaceEstablishedExplicitAuthority(
      sourceResponseFormat,
      sourceResponseState,
    )
  }
  if (sourceResponseFormat === 'topic_clauses') {
    return autoTopicSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState)
  }
  if (sourceResponseFormat === 'topic_sentences') {
    return autoTopicSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState)
  }
  if (sourceResponseFormat === 'topic_spans') {
    return autoTopicSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState)
  }
  if (sourceResponseFormat === 'topic_middle_spans') {
    return autoTopicSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState)
  }
  if (sourceResponseFormat === 'topic_closing_spans') {
    return autoTopicSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState)
  }
  if (sourceResponseFormat === 'topic_closing_blocks') {
    return autoTopicSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState)
  }
  if (sourceResponseFormat === 'topic_paragraphs') {
    return autoTopicSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState)
  }
  if (sourceResponseFormat === 'topic_middle_blocks') {
    return autoTopicSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState)
  }
  if (sourceResponseFormat === 'topic_blocks') {
    return autoTopicSurfaceEstablishedExplicitAuthority(sourceResponseFormat, sourceResponseState)
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
    return !autoInlineTopicsShouldYieldToExplicitTopicAuthority(sourceResponseState)
  }
  if (message.includes('included incomplete topic authority for "')) {
    return !autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics(
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

function assertAutoSourceResponseFormatDidNotStopAtWeakerInlineTopics(
  sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
  sourceResponseState: InterpretedSourceResponseState | undefined,
) {
  if (
    sourceResponseFormat === 'inline_topics' &&
    autoInlineTopicsShouldYieldToExplicitTopicAuthority(sourceResponseState)
  ) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat inline_topics yielded weaker label/value authority than an explicit topic surface already present in sourceResponse.',
    )
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
    if (parseLabeledSourceResponseSections(shared).size > 0) {
      return
    }
  } catch (error) {
    if (error instanceof AnswerInterpretationError) {
      return
    }
    throw error
  }

  for (const clause of splitInlineTopicClauses(shared)) {
    const trimmedClause = stripLeadingPresentationListMarkers(
      clause.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (
      !trimmedClause ||
      !inlineTopicClauseUsesNonLabeledSectionExplicitLabelValueSeparator(trimmedClause)
    ) {
      continue
    }

    const parsed = parseInlineTopicClause(clause)
    if (!parsed) {
      continue
    }

    try {
      assertExplicitLabelTextDoesNotContainAuthority(parsed.label, 'Inline topic clause label')
      assertLabeledValueAuthorityMatchesLabel(
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

    continue
  }

  for (const clause of splitInlineTopicClauses(shared)) {
    const parsed = parseInlineTopicClause(clause)
    if (!parsed) {
      continue
    }

    try {
      assertLabeledValueAuthorityMatchesLabel(
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
    collectSemanticallyValidInlineTopicClauseIndexes(shared)
  if (semanticallyValidInlineTopicClauseIndexes.size === 0) {
    return
  }

  for (const chunk of groupRemainingNonInlineTopicClauseChunks(
    shared,
    semanticallyValidInlineTopicClauseIndexes,
  )) {
    assertTextDoesNotContainMalformedStandaloneQuestionSpanAuthority(chunk)
  }

  const standaloneQuestionAuthorities = dedupeNonEmptyStrings(
    splitInlineTopicClauses(shared).flatMap((clause, clauseIndex) =>
      semanticallyValidInlineTopicClauseIndexes.has(clauseIndex)
        ? []
        : extractQuestionAuthorityTextsFromText(clause),
    ),
  )
  if (standaloneQuestionAuthorities.length > 0) {
    throw new AutoSourceResponseTerminalError(
      `sourceResponseFormat inline_topics rejected sourceResponse because it still included standalone question authority ${formatQuotedValueList(standaloneQuestionAuthorities)} outside inline topic clauses.`,
    )
  }
}

function inlineTopicQuestionAuthorityShouldYieldToQuestionFamily(clause: string) {
  const trimmedClause = stripLeadingPresentationListMarkers(
    clause.trim().replace(/^(?:and|but)\s+/i, ''),
  )
  if (!trimmedClause) {
    return false
  }

  if (isQuestionSourceResponseSentence(trimmedClause)) {
    return true
  }

  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(trimmedClause)
  if (resolveCanonicalQuestionAnchorMatch(trimmedClause, tokens, 0)) {
    return true
  }

  try {
    return parseQuestionSourceResponseClauses(trimmedClause).length > 0
  } catch (error) {
    if (error instanceof AnswerInterpretationError) {
      return false
    }
    throw error
  }
}

function assertAutoPlanningDidNotSkipUnsupportedExplicitLabelAuthority(
  followThrough: InterpretableDecisionFollowThroughInput,
  sourceResponse: string | undefined,
  sourceResponseState: InterpretedSourceResponseState | undefined,
) {
  if (!followThroughInfersRemainingAnswers(followThrough) || !sourceResponse?.trim()) {
    return
  }

  let labeledSections: Map<string, LabeledSourceResponseSection>
  try {
    labeledSections = parseRequiredLabeledSourceResponseSections(
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
      assertLabeledValueAuthorityMatchesLabel(
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
      assertAutoLabeledSectionsDidNotSkipStandaloneQuestionAuthority(
        sourceResponse,
        labeledSections,
      )
      assertAutoLabeledSectionsDidNotSkipStandaloneTopicAuthority(
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
  if (sourceResponseHasQuestionSentenceAuthority(sourceResponse)) {
    return
  }

  let inlineTopics: Map<string, LabeledSourceResponseSection>
  try {
    inlineTopics = parseRequiredInlineTopicSections(
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
      assertLabeledValueAuthorityMatchesLabel(
        section.label,
        section.value,
        'Inline topic clause',
        'answer text',
      )
      } catch (error) {
        if (
          error instanceof AnswerInterpretationError &&
          error.message.includes('included incomplete topic authority for "') &&
          autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics(
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
    !autoInlineTopicsShouldYieldToExplicitTopicAuthority(sourceResponseState)
  ) {
    try {
      const consumedInlineTopicLabels = new Set(inlineTopics.keys())
      assertDirectInlineTopicsDidNotSkipStandaloneQuestionAuthority(
        sourceResponse,
        inlineTopics,
        consumedInlineTopicLabels,
      )
      assertDirectInlineTopicsDidNotSkipStandaloneTopicAuthority(
        sourceResponse,
        inlineTopics,
        consumedInlineTopicLabels,
      )
      assertSeparatorStyleInlineTopicsDidNotMixWithAdditionalVerbalInlineTopicAuthority(
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

export function materializeInterpretedDecisionAnswers(
  answers: InterpretableDecisionAnswerEntryInput[],
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
  additionalSourceResponseCandidates: string[][] = [],
  rejectMultipleInferredTopicSummariesInTopicUnits = false,
): MaterializedInterpretedDecisionAnswer[] {
  const resolvedAnswerSources = createResolvedAnswerSources(answerSources, sourceResponse)
  const answerSourcesByKey = resolvedAnswerSources?.byKey
  const answerSourceGroupsByKey = resolvedAnswerSources?.byGroupKey
  const pendingAnswerSourceEntries = resolvedAnswerSources?.entries
  const matchingAnswerSourceEntries = resolvedAnswerSources?.entries
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  registerTopicAnchorCandidates(interpretationState, [
    ...answers.map((answer) => buildDecisionAnswerSourceResponseCandidates(answer)),
    ...additionalSourceResponseCandidates,
  ])
  registerQuestionAnchorCandidateGroups(interpretationState, [
    ...answers.map((answer) => buildDecisionAnswerSourceResponseCandidates(answer)),
    ...additionalSourceResponseCandidates,
  ])
  registerMatchingRunCandidateGroups(interpretationState, [
    ...answers.map((answer) => buildDecisionAnswerSourceResponseCandidates(answer)),
    ...additionalSourceResponseCandidates,
  ])

  return answers.map((answer) => {
    const resolved = resolveAnswerContent(
      answer.answer,
      answer.sourceExcerpt,
      answer.sourceOccurrence,
      answer.answerSourceKey,
      answer.answerSourceGroupKey,
      sourceResponse,
      `decision answer ${answer.decisionKey ?? answer.summary}`,
      answerSourcesByKey,
      answerSourceGroupsByKey,
      pendingAnswerSourceEntries,
      matchingAnswerSourceEntries,
      sourceResponseFormat,
      buildDecisionAnswerSourceResponseCandidates(answer),
      interpretationState,
      buildDecisionPendingAnswerSourceConsumerDescriptor(answer),
      rejectMultipleInferredTopicSummariesInTopicUnits,
    )
    return attachCaptureFormat(
      {
        summary: answer.summary,
        ...(answer.summaryKey?.trim() ? { summaryKey: answer.summaryKey.trim() } : {}),
        prompt: answer.prompt?.trim() || resolved.prompt,
        matchHints: answer.matchHints,
        decisionKey: answer.decisionKey,
        taskRef: answer.taskRef,
        answer: resolved.answer,
      },
      resolved.captureFormat,
    )
  })
}

export function materializeInterpretedDecisionAnswerBatch(
  answers: InterpretableDecisionAnswerEntryInput[] | undefined,
  openDecisions: InterpretableOpenDecision[],
  inferOpenDecisions: boolean,
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
  inferDecisionTopics = false,
  knownDecisions: InterpretableKnownDecision[] = [],
  reservedAnswerCandidates: string[] | string[][] = [],
): MaterializedInterpretedDecisionAnswer[] {
  const explicitAnswers = answers ?? []
  if (inferOpenDecisions && explicitAnswers.some((answer) => !answer.decisionKey?.trim())) {
    throw new AnswerInterpretationError(
      'inferOpenDecisions requires every explicit answer entry to include decisionKey.',
    )
  }

  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  const reservedAnswerCandidateGroups =
    normalizeReservedAnswerCandidateGroups(reservedAnswerCandidates)
  registerTopicAnchorCandidates(interpretationState, [
    ...explicitAnswers.map((answer) => buildDecisionAnswerSourceResponseCandidates(answer)),
    ...openDecisions.map((decision) => buildOpenDecisionSourceResponseCandidates(decision)),
    ...knownDecisions.map((decision) => buildKnownDecisionSourceResponseCandidates(decision)),
    ...reservedAnswerCandidateGroups,
  ])
  registerQuestionAnchorCandidateGroups(interpretationState, [
    ...explicitAnswers.map((answer) => buildDecisionAnswerSourceResponseCandidates(answer)),
    ...openDecisions.map((decision) => buildOpenDecisionSourceResponseCandidates(decision)),
    ...knownDecisions.map((decision) => buildKnownDecisionSourceResponseCandidates(decision)),
    ...reservedAnswerCandidateGroups,
  ])
  registerMatchingRunCandidateGroups(interpretationState, [
    ...explicitAnswers.map((answer) => buildDecisionAnswerSourceResponseCandidates(answer)),
    ...openDecisions.map((decision) => buildOpenDecisionSourceResponseCandidates(decision)),
    ...knownDecisions.map((decision) => buildKnownDecisionSourceResponseCandidates(decision)),
    ...reservedAnswerCandidateGroups,
  ])
  const materializedExplicitAnswers = materializeInterpretedDecisionAnswers(
    explicitAnswers,
    sourceResponse,
    answerSources,
    sourceResponseFormat,
    interpretationState,
    [
      ...openDecisions.map((decision) => buildOpenDecisionSourceResponseCandidates(decision)),
      ...knownDecisions.map((decision) => buildKnownDecisionSourceResponseCandidates(decision)),
      ...reservedAnswerCandidateGroups,
    ],
    true,
  )
  const explicitDecisionKeys = new Set(
    materializedExplicitAnswers.flatMap((answer) =>
      answer.decisionKey ? [answer.decisionKey] : [],
    ),
  )
  const matchedOpenDecisionAnswers = inferOpenDecisions
    ? materializeMatchingOpenDecisionAnswers(
        openDecisions,
        explicitDecisionKeys,
        sourceResponse,
        answerSources,
        sourceResponseFormat,
        interpretationState,
      )
    : []
  const materializedAnswers = [
    ...materializedExplicitAnswers,
    ...matchedOpenDecisionAnswers,
    ...materializeNewDecisionTopicAnswers(
      explicitAnswers,
      openDecisions,
      inferOpenDecisions,
      inferDecisionTopics,
      sourceResponse,
      answerSources,
      sourceResponseFormat,
      interpretationState,
      knownDecisions,
      reservedAnswerCandidateGroups,
    ),
  ]

  if (materializedAnswers.length === 0) {
    if (inferDecisionTopics && sourceResponseFormat === 'labeled_sections') {
      const labeledSections = parseRequiredLabeledSourceResponseSections(
        sourceResponse,
        'inferDecisionTopics',
        interpretationState,
      )
      if (labeledSections.size === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat labeled_sections requires at least one labeled section when inferDecisionTopics is enabled.',
        )
      }
    }
    if (inferOpenDecisions && sourceResponseFormat === 'labeled_sections') {
      const labeledSections = parseRequiredLabeledSourceResponseSections(
        sourceResponse,
        'inferOpenDecisions',
        interpretationState,
      )
      if (labeledSections.size === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat labeled_sections requires at least one labeled section when inferOpenDecisions is enabled.',
        )
      }
      if (openDecisions.length > 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat labeled_sections requires at least one labeled section to match an open decision when inferOpenDecisions is enabled.',
        )
      }
    }
    if (inferDecisionTopics && sourceResponseFormat === 'inline_topics') {
      const inlineTopics = parseRequiredInlineTopicSections(
        sourceResponse,
        'inferDecisionTopics',
        interpretationState,
      )
      if (inlineTopics.size === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat inline_topics requires at least one inline topic clause when inferDecisionTopics is enabled.',
        )
      }
    }
    if (inferOpenDecisions && sourceResponseFormat === 'inline_topics') {
      const inlineTopics = parseRequiredInlineTopicSections(
        sourceResponse,
        'inferOpenDecisions',
        interpretationState,
      )
      if (inlineTopics.size === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat inline_topics requires at least one inline topic clause when inferOpenDecisions is enabled.',
        )
      }
      if (openDecisions.length > 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat inline_topics requires at least one inline topic clause to match an open decision when inferOpenDecisions is enabled.',
        )
      }
    }
    if (inferOpenDecisions) {
      throwSpecificOpenDecisionSurfaceNoMatchError(
        openDecisions,
        explicitDecisionKeys,
        sourceResponse,
        answerSources,
        sourceResponseFormat,
        interpretationState,
      )
    }
    throw new AnswerInterpretationError(
      'No decision answers were materialized. Provide explicit answers or use inferOpenDecisions with structured sourceResponse items that match at least one open decision.',
    )
  }

  return materializedAnswers
}

function throwSpecificOpenDecisionSurfaceNoMatchError(
  openDecisions: InterpretableOpenDecision[],
  explicitDecisionKeys: Set<string>,
  sourceResponse: string | undefined,
  answerSources: InterpretableAnswerSource[] | undefined,
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  sourceResponseState: InterpretedSourceResponseState | undefined,
) {
  const unresolvedOpenDecision = openDecisions.find(
    (decision) => !explicitDecisionKeys.has(decision.decisionKey),
  )
  if (!unresolvedOpenDecision) {
    return
  }

  const candidates = buildOpenDecisionSourceResponseCandidates(unresolvedOpenDecision)
  const label = `open decision ${unresolvedOpenDecision.decisionKey}`

  if (sourceResponseFormat === 'matching_answer_sources') {
    const resolvedAnswerSources = createResolvedAnswerSources(answerSources, sourceResponse)
    resolveMatchingAnswerSourceValue(
      resolvedAnswerSources?.entries,
      candidates,
      label,
      sourceResponseState,
      'decision',
    )
    return
  }

  if (sourceResponseFormat === 'matching_runs') {
    resolveMatchingRunSourceResponseValue(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
    )
    return
  }

  if (sourceResponseFormat === 'matching_opening_runs') {
    resolveMatchingOpeningRunSourceResponseValue(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
    )
    return
  }

  if (sourceResponseFormat === 'matching_closing_runs') {
    resolveMatchingClosingRunSourceResponseValue(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
    )
    return
  }

  if (sourceResponseFormat === 'matching_middle_runs') {
    resolveMatchingMiddleRunSourceResponseValue(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
    )
    return
  }

  if (sourceResponseFormat === 'question_blocks') {
    consumeQuestionBlockSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'question_clauses') {
    consumeQuestionClauseSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'question_spans') {
    consumeQuestionSpanSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'question_middle_spans') {
    consumeQuestionMiddleSpanSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'question_closing_spans') {
    consumeQuestionClosingSpanSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'question_closing_blocks') {
    consumeQuestionClosingBlockSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'question_middle_blocks') {
    consumeQuestionMiddleBlockSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'topic_clauses') {
    consumeTopicClauseSourceResponseSection(
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
    consumeTopicSentenceSourceResponseSection(
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
    consumeTopicSpanSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'topic_middle_spans') {
    consumeTopicMiddleSpanSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'topic_closing_spans') {
    consumeTopicClosingSpanSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'topic_closing_blocks') {
    consumeTopicClosingBlockSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'topic_paragraphs') {
    consumeTopicParagraphSourceResponseSection(
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
    consumeTopicMiddleBlockSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
    return
  }

  if (sourceResponseFormat === 'topic_blocks') {
    consumeTopicBlockSourceResponseSection(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      true,
    )
  }
}

export function materializeInterpretedDecisionBundle(input: {
  answers: InterpretableDecisionAnswerEntryInput[] | undefined
  openDecisions: InterpretableOpenDecision[]
  inferOpenDecisions: boolean
  sourceResponse?: string
  answerSources?: InterpretableAnswerSource[]
  sourceResponseFormat?: InterpretableSourceResponseFormat
  inferDecisionTopics?: boolean
  knownDecisions?: InterpretableKnownDecision[]
  followThrough?: InterpretableDecisionFollowThroughInput
  reservedAnswerCandidates?: string[] | string[][]
}) {
  const resolvedSourceResponseFormat = resolveAutoSourceResponseFormat(
    input.sourceResponseFormat,
    listAutoSourceResponseFormatCandidates({
      hasSourceResponse: Boolean(input.sourceResponse?.trim()),
      hasAnswerSources: Boolean(input.answerSources?.length),
      needsExplicitAnswerInterpretation:
        (input.answers?.length ?? 0) > 0 ||
        listInterpretableFollowThroughAnswerSummaries(input.followThrough).length > 0,
      inferOpenDecisions: input.inferOpenDecisions,
      inferDecisionTopics: input.inferDecisionTopics ?? false,
      inferRemainingAnswers: followThroughInfersRemainingAnswers(input.followThrough),
      sourceResponse: input.sourceResponse,
    }),
    (candidateFormat) => {
      const state = createInterpretedSourceResponseState(input.sourceResponse, candidateFormat)
      const mixedRemainingAnswerSourceInference = hasMixedRemainingAnswerSourceInference(input)
      assertAutoDidNotSkipMalformedExplicitInlineTopicAuthority(input.sourceResponse)
      try {
        if (
          mixedRemainingAnswerSourceInference &&
          !supportsMixedRemainingAnswerSourceInference(candidateFormat)
        ) {
          throw new AnswerInterpretationError(
            'followThrough.inferRemainingAnswers can only be combined with inferDecisionTopics when sourceResponseFormat is "pending_answer_sources" or "matching_answer_sources" and the remaining answerSources are explicitly routed by route, decisionKey, or answerKey.',
          )
        }
        if (mixedRemainingAnswerSourceInference) {
          materializeInterpretedDecisionAnswerBatch(
            input.answers,
            input.openDecisions,
            input.inferOpenDecisions,
            input.sourceResponse,
            input.answerSources,
            candidateFormat,
            state,
            false,
            input.knownDecisions ?? [],
            input.reservedAnswerCandidates ?? [],
          )
          materializeInterpretedDecisionFollowThrough(
            input.followThrough
              ? {
                  ...input.followThrough,
                  inferRemainingAnswers: false,
                }
              : undefined,
            input.sourceResponse,
            input.answerSources,
            candidateFormat,
            state,
            false,
          )
          materializeMixedRemainingAnswerSourceInference({
            sourceResponse: input.sourceResponse,
            answerSources: input.answerSources,
            sourceResponseFormat: candidateFormat,
            sourceResponseState: state,
            knownDecisions: input.knownDecisions ?? [],
          })
        } else {
          materializeInterpretedDecisionAnswerBatch(
            input.answers,
            input.openDecisions,
            input.inferOpenDecisions,
            input.sourceResponse,
            input.answerSources,
            candidateFormat,
            state,
            input.inferDecisionTopics ?? false,
            input.knownDecisions ?? [],
            input.reservedAnswerCandidates ?? [],
          )
          materializeInterpretedDecisionFollowThrough(
            input.followThrough,
            input.sourceResponse,
            input.answerSources,
            candidateFormat,
            state,
            false,
          )
        }
        if (candidateFormat === 'inline_topics') {
          assertDirectLabelFamilySourceResponseCompleteness({
            sourceResponse: input.sourceResponse,
            sourceResponseFormat: candidateFormat,
            sourceResponseState: state,
            label: 'sourceResponseFormat auto',
          })
        }
        assertAutoSourceResponseFormatCompleteness({
          sourceResponse: input.sourceResponse,
          answerSources: input.answerSources,
          sourceResponseFormat: candidateFormat,
          sourceResponseState: state,
          inferDecisionTopics: input.inferDecisionTopics ?? false,
          inferRemainingAnswers: followThroughInfersRemainingAnswers(input.followThrough),
        })
        assertAutoSourceResponseFormatDidNotStopAtWeakerInlineTopics(candidateFormat, state)
      } catch (error) {
        if (isTerminalLabelFamilyAutoProbeError(candidateFormat, error, state)) {
          throw new AutoSourceResponseTerminalError(
            error instanceof Error ? error.message : String(error),
          )
        }
        if (shouldAutoSourceResponseProbeFailClosed(candidateFormat, state)) {
          throw new AutoSourceResponseTerminalError(
            error instanceof Error ? error.message : String(error),
          )
        }
        throw error
      }
    },
    'decision answer bundle',
  )
  const state = createInterpretedSourceResponseState(
    input.sourceResponse,
    resolvedSourceResponseFormat,
  )
  const mixedRemainingAnswerSourceInference = hasMixedRemainingAnswerSourceInference(input)
  if (
    mixedRemainingAnswerSourceInference &&
    !supportsMixedRemainingAnswerSourceInference(resolvedSourceResponseFormat)
  ) {
    throw new AnswerInterpretationError(
      'followThrough.inferRemainingAnswers can only be combined with inferDecisionTopics when sourceResponseFormat is "pending_answer_sources" or "matching_answer_sources" and the remaining answerSources are explicitly routed by route, decisionKey, or answerKey.',
    )
  }

  if (mixedRemainingAnswerSourceInference) {
    const explicitAnswers = materializeInterpretedDecisionAnswerBatch(
      input.answers,
      input.openDecisions,
      input.inferOpenDecisions,
      input.sourceResponse,
      input.answerSources,
      resolvedSourceResponseFormat,
      state,
      false,
      input.knownDecisions ?? [],
      input.reservedAnswerCandidates ?? [],
    )
    const explicitFollowThrough = materializeInterpretedDecisionFollowThrough(
      input.followThrough
        ? {
            ...input.followThrough,
            inferRemainingAnswers: false,
          }
        : undefined,
      input.sourceResponse,
      input.answerSources,
      resolvedSourceResponseFormat,
      state,
      false,
    )
    const inferred = materializeMixedRemainingAnswerSourceInference({
      sourceResponse: input.sourceResponse,
      answerSources: input.answerSources,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      knownDecisions: input.knownDecisions ?? [],
    })
    const followThrough =
      explicitFollowThrough && inferred.planningAnswers.length > 0
        ? explicitFollowThrough.kind === 'workflow_batch'
          ? {
              ...explicitFollowThrough,
              inferRemainingAnswers: true,
              answers: mergeMaterializedPlanningAnswers(
                explicitFollowThrough.answers,
                inferred.planningAnswers,
              ),
            }
          : {
              ...explicitFollowThrough,
              inferRemainingAnswers: true,
              answers: mergeMaterializedPlanningAnswers(
                explicitFollowThrough.answers,
                inferred.planningAnswers,
              ),
            }
        : explicitFollowThrough && input.followThrough
          ? {
              ...explicitFollowThrough,
              inferRemainingAnswers: input.followThrough.inferRemainingAnswers,
            }
          : explicitFollowThrough

    assertNoUnusedExplicitlyRoutedAnswerSources({
      sourceResponse: input.sourceResponse,
      answerSources: input.answerSources,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      label: 'decision answer bundle',
    })
    assertDirectAnswerSourceFamilySourceResponseCompleteness({
      sourceResponse: input.sourceResponse,
      answerSources: input.answerSources,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      label: 'decision answer bundle',
    })
    assertDirectMatchingRunSourceResponseCompleteness({
      sourceResponse: input.sourceResponse,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      label: 'decision answer bundle',
    })
    assertDirectLabelFamilySourceResponseCompleteness({
      sourceResponse: input.sourceResponse,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      label: 'decision answer bundle',
    })
    assertDirectQuestionAndTopicSourceResponseCompleteness({
      sourceResponse: input.sourceResponse,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      label: 'decision answer bundle',
    })
    assertDirectOrderedSourceResponseCompleteness({
      sourceResponse: input.sourceResponse,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      label: 'decision answer bundle',
    })
    assertDirectPendingSourceResponseCompleteness({
      sourceResponse: input.sourceResponse,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      label: 'decision answer bundle',
    })

    return {
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      answers: [...explicitAnswers, ...inferred.decisionAnswers],
      followThrough,
    }
  }

  const answers = materializeInterpretedDecisionAnswerBatch(
    input.answers,
    input.openDecisions,
    input.inferOpenDecisions,
    input.sourceResponse,
    input.answerSources,
    resolvedSourceResponseFormat,
    state,
    input.inferDecisionTopics ?? false,
    input.knownDecisions ?? [],
    input.reservedAnswerCandidates ?? [],
  )
  const followThrough = materializeInterpretedDecisionFollowThrough(
    input.followThrough,
    input.sourceResponse,
    input.answerSources,
    resolvedSourceResponseFormat,
    state,
    false,
  )
  assertNoUnusedExplicitlyRoutedAnswerSources({
    sourceResponse: input.sourceResponse,
    answerSources: input.answerSources,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: state,
    label: 'decision answer bundle',
  })
  assertDirectAnswerSourceFamilySourceResponseCompleteness({
    sourceResponse: input.sourceResponse,
    answerSources: input.answerSources,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: state,
    label: 'decision answer bundle',
  })
  assertDirectMatchingRunSourceResponseCompleteness({
    sourceResponse: input.sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: state,
    label: 'decision answer bundle',
  })
  assertDirectLabelFamilySourceResponseCompleteness({
    sourceResponse: input.sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: state,
    label: 'decision answer bundle',
  })
  assertDirectQuestionAndTopicSourceResponseCompleteness({
    sourceResponse: input.sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: state,
    label: 'decision answer bundle',
  })
  assertDirectOrderedSourceResponseCompleteness({
    sourceResponse: input.sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: state,
    label: 'decision answer bundle',
  })
  assertDirectPendingSourceResponseCompleteness({
    sourceResponse: input.sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: state,
    label: 'decision answer bundle',
  })

  return {
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: state,
    answers,
    followThrough,
  }
}

function normalizeReservedAnswerCandidateGroups(reservedAnswerCandidates: string[] | string[][]) {
  if (reservedAnswerCandidates.length === 0) {
    return []
  }

  const firstCandidate = reservedAnswerCandidates[0]
  if (Array.isArray(firstCandidate)) {
    return reservedAnswerCandidates as string[][]
  }

  return (reservedAnswerCandidates as string[]).map((summary) => [summary])
}

export function materializeInterpretedDecisionFollowThrough(
  followThrough: InterpretableDecisionFollowThroughInput | undefined,
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
  enforceDirectSourceResponseCompleteness = true,
) {
  if (!followThrough) {
    return undefined
  }
  const resolvedAnswerSources = createResolvedAnswerSources(answerSources, sourceResponse)
  const answerSourcesByKey = resolvedAnswerSources?.byKey
  const answerSourceGroupsByKey = resolvedAnswerSources?.byGroupKey
  const pendingAnswerSourceEntries = resolvedAnswerSources?.entries
  const matchingAnswerSourceEntries = resolvedAnswerSources?.entries
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  registerTopicAnchorCandidates(interpretationState, [
    ...listInterpretableFollowThroughAnswerCandidateGroups(followThrough),
  ])
  registerQuestionAnchorCandidateGroups(interpretationState, [
    ...listInterpretableFollowThroughAnswerCandidateGroups(followThrough),
  ])

  if (followThrough.kind === 'planning') {
    const materialized = {
      ...followThrough,
      answers: materializeInterpretedPlanningAnswers(
        followThrough.answers,
        sourceResponse,
        answerSourcesByKey,
        answerSourceGroupsByKey,
        pendingAnswerSourceEntries,
        matchingAnswerSourceEntries,
        sourceResponseFormat,
        interpretationState,
        followThrough.inferRemainingAnswers ?? false,
      ),
    }
    if (enforceDirectSourceResponseCompleteness) {
      assertDirectAnswerSourceFamilySourceResponseCompleteness({
        sourceResponse,
        answerSources,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough "${followThrough.title}"`,
      })
      assertDirectMatchingRunSourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough "${followThrough.title}"`,
      })
      assertDirectLabelFamilySourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough "${followThrough.title}"`,
      })
      assertDirectQuestionAndTopicSourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough "${followThrough.title}"`,
      })
      assertDirectOrderedSourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough "${followThrough.title}"`,
      })
      assertDirectPendingSourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough "${followThrough.title}"`,
      })
    }
    return {
      ...materialized,
    }
  }

  if (followThrough.kind === 'planning_batch') {
    const materialized = {
      ...followThrough,
      answers: materializeInterpretedPlanningAnswers(
        followThrough.answers,
        sourceResponse,
        answerSourcesByKey,
        answerSourceGroupsByKey,
        pendingAnswerSourceEntries,
        matchingAnswerSourceEntries,
        sourceResponseFormat,
        interpretationState,
        followThrough.inferRemainingAnswers ?? false,
      ),
    }
    if (enforceDirectSourceResponseCompleteness) {
      assertDirectAnswerSourceFamilySourceResponseCompleteness({
        sourceResponse,
        answerSources,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough batch "${followThrough.groupKey}"`,
      })
      assertDirectMatchingRunSourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough batch "${followThrough.groupKey}"`,
      })
      assertDirectLabelFamilySourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough batch "${followThrough.groupKey}"`,
      })
      assertDirectQuestionAndTopicSourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough batch "${followThrough.groupKey}"`,
      })
      assertDirectOrderedSourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough batch "${followThrough.groupKey}"`,
      })
      assertDirectPendingSourceResponseCompleteness({
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState: interpretationState,
        label: `followThrough batch "${followThrough.groupKey}"`,
      })
    }
    return {
      ...materialized,
    }
  }

  const rootSharedAnswers = materializeInterpretedPlanningAnswers(
    followThrough.answers,
    sourceResponse,
    answerSourcesByKey,
    answerSourceGroupsByKey,
    pendingAnswerSourceEntries,
    matchingAnswerSourceEntries,
    sourceResponseFormat,
    interpretationState,
    false,
  )

  const workflows = followThrough.workflows.map((workflow) => {
    if (workflow.kind === 'planning') {
      return {
        ...workflow,
        answers: materializeInterpretedPlanningAnswers(
          workflow.answers,
          sourceResponse,
          answerSourcesByKey,
          answerSourceGroupsByKey,
          pendingAnswerSourceEntries,
          matchingAnswerSourceEntries,
          sourceResponseFormat,
          interpretationState,
          false,
        ),
      }
    }

    return {
      ...workflow,
      answers: materializeInterpretedPlanningAnswers(
        workflow.answers,
        sourceResponse,
        answerSourcesByKey,
        answerSourceGroupsByKey,
        pendingAnswerSourceEntries,
        matchingAnswerSourceEntries,
        sourceResponseFormat,
        interpretationState,
        false,
      ),
    }
  })

  const materialized = {
    kind: 'workflow_batch' as const,
    workflowKey: followThrough.workflowKey,
    reuseTaskRef: followThrough.reuseTaskRef,
    reuseGroupKey: followThrough.reuseGroupKey,
    inferRemainingAnswers: followThrough.inferRemainingAnswers,
    answers: mergeMaterializedPlanningAnswers(
      rootSharedAnswers,
      followThrough.inferRemainingAnswers
        ? materializeRemainingInterpretedPlanningAnswers(
            sourceResponse,
            sourceResponseFormat,
            interpretationState,
            pendingAnswerSourceEntries,
            matchingAnswerSourceEntries,
          )
        : [],
    ),
    workflows,
  }
  if (enforceDirectSourceResponseCompleteness) {
    assertDirectAnswerSourceFamilySourceResponseCompleteness({
      sourceResponse,
      answerSources,
      sourceResponseFormat,
      sourceResponseState: interpretationState,
      label: `followThrough workflow batch "${followThrough.workflowKey ?? 'workflow_batch'}"`,
    })
    assertDirectMatchingRunSourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState: interpretationState,
      label: `followThrough workflow batch "${followThrough.workflowKey ?? 'workflow_batch'}"`,
    })
    assertDirectLabelFamilySourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState: interpretationState,
      label: `followThrough workflow batch "${followThrough.workflowKey ?? 'workflow_batch'}"`,
    })
    assertDirectQuestionAndTopicSourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState: interpretationState,
      label: `followThrough workflow batch "${followThrough.workflowKey ?? 'workflow_batch'}"`,
    })
    assertDirectOrderedSourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState: interpretationState,
      label: `followThrough workflow batch "${followThrough.workflowKey ?? 'workflow_batch'}"`,
    })
    assertDirectPendingSourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState: interpretationState,
      label: `followThrough workflow batch "${followThrough.workflowKey ?? 'workflow_batch'}"`,
    })
  }

  return materialized
}

function resolveAutoPlanningSourceResponseFormat(
  followThrough: InterpretableDecisionFollowThroughInput,
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
) {
  return resolveAutoSourceResponseFormat(
    sourceResponseFormat,
    listAutoSourceResponseFormatCandidates({
      hasSourceResponse: Boolean(sourceResponse?.trim()),
      hasAnswerSources: Boolean(answerSources?.length),
      needsExplicitAnswerInterpretation:
        listInterpretableFollowThroughAnswerSummaries(followThrough).length > 0,
      inferRemainingAnswers: followThroughInfersRemainingAnswers(followThrough),
      sourceResponse,
    }),
    (candidateFormat) => {
      const state = createInterpretedSourceResponseState(sourceResponse, candidateFormat)
      assertAutoPlanningDidNotSkipUnsupportedExplicitLabelAuthority(
        followThrough,
        sourceResponse,
        state,
      )
      try {
        materializeInterpretedDecisionFollowThrough(
          followThrough,
          sourceResponse,
          answerSources,
          candidateFormat,
          state,
          false,
        )
        if (candidateFormat === 'inline_topics') {
          assertDirectLabelFamilySourceResponseCompleteness({
            sourceResponse,
            sourceResponseFormat: candidateFormat,
            sourceResponseState: state,
            label: 'sourceResponseFormat auto',
          })
        }
        assertAutoSourceResponseFormatCompleteness({
          sourceResponse,
          answerSources,
          sourceResponseFormat: candidateFormat,
          sourceResponseState: state,
        })
        assertAutoSourceResponseFormatDidNotStopAtWeakerInlineTopics(candidateFormat, state)
      } catch (error) {
        if (isTerminalLabelFamilyAutoProbeError(candidateFormat, error, state)) {
          throw new AutoSourceResponseTerminalError(
            error instanceof Error ? error.message : String(error),
          )
        }
        if (shouldAutoSourceResponseProbeFailClosed(candidateFormat, state)) {
          throw new AutoSourceResponseTerminalError(
            error instanceof Error ? error.message : String(error),
          )
        }
        throw error
      }
    },
    followThrough.kind,
  )
}

export function materializeInterpretedPlanningInput<
  T extends {
    title: string
    description: string
    acceptanceCriteria: string[]
    requestedUpdates?: GoalPlanningRequestUpdateTarget[]
    inferRemainingAnswers?: boolean
    answers?: InterpretablePlanningAnswer[]
  },
>(
  input: T,
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
): MaterializedPlanningAnswerCarrier<T> {
  const followThrough = {
    kind: 'planning' as const,
    title: input.title,
    description: input.description,
    acceptanceCriteria: input.acceptanceCriteria,
    answers: input.answers,
    requestedUpdates: input.requestedUpdates,
    inferRemainingAnswers: input.inferRemainingAnswers,
  }
  const resolvedSourceResponseFormat = resolveAutoPlanningSourceResponseFormat(
    followThrough,
    sourceResponse,
    answerSources,
    sourceResponseFormat,
  )
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, resolvedSourceResponseFormat)
  const materialized = materializeInterpretedDecisionFollowThrough(
    followThrough,
    sourceResponse,
    answerSources,
    resolvedSourceResponseFormat,
    interpretationState,
    false,
  )
  if (!materialized || materialized.kind !== 'planning') {
    throw new Error(`Expected materialized planning input for ${input.title}.`)
  }
  assertNoUnusedExplicitlyRoutedAnswerSources({
    sourceResponse,
    answerSources,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning input "${input.title}"`,
  })
  assertDirectAnswerSourceFamilySourceResponseCompleteness({
    sourceResponse,
    answerSources,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning input "${input.title}"`,
  })
  assertDirectMatchingRunSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning input "${input.title}"`,
  })
  assertDirectLabelFamilySourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning input "${input.title}"`,
  })
  assertDirectQuestionAndTopicSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning input "${input.title}"`,
  })
  assertDirectOrderedSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning input "${input.title}"`,
  })
  assertDirectPendingSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning input "${input.title}"`,
  })

  return {
    ...input,
    answers: materialized.answers,
    resolvedSourceResponseFormat,
  }
}

export function materializeInterpretedPlanningBatchInput<
  T extends {
    groupKey: string
    requests: GoalPlanningBatchEntryInput[]
    inferRemainingAnswers?: boolean
    answers?: InterpretablePlanningAnswer[]
  },
>(
  input: T,
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
): MaterializedPlanningAnswerCarrier<T> {
  const followThrough = {
    kind: 'planning_batch' as const,
    groupKey: input.groupKey,
    requests: input.requests,
    answers: input.answers,
    inferRemainingAnswers: input.inferRemainingAnswers,
  }
  const resolvedSourceResponseFormat = resolveAutoPlanningSourceResponseFormat(
    followThrough,
    sourceResponse,
    answerSources,
    sourceResponseFormat,
  )
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, resolvedSourceResponseFormat)
  const materialized = materializeInterpretedDecisionFollowThrough(
    followThrough,
    sourceResponse,
    answerSources,
    resolvedSourceResponseFormat,
    interpretationState,
    false,
  )
  if (!materialized || materialized.kind !== 'planning_batch') {
    throw new Error(`Expected materialized planning batch input for ${input.groupKey}.`)
  }
  assertNoUnusedExplicitlyRoutedAnswerSources({
    sourceResponse,
    answerSources,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning batch "${input.groupKey}"`,
  })
  assertDirectAnswerSourceFamilySourceResponseCompleteness({
    sourceResponse,
    answerSources,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning batch "${input.groupKey}"`,
  })
  assertDirectMatchingRunSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning batch "${input.groupKey}"`,
  })
  assertDirectLabelFamilySourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning batch "${input.groupKey}"`,
  })
  assertDirectQuestionAndTopicSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning batch "${input.groupKey}"`,
  })
  assertDirectOrderedSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning batch "${input.groupKey}"`,
  })
  assertDirectPendingSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning batch "${input.groupKey}"`,
  })

  return {
    ...input,
    answers: materialized.answers,
    resolvedSourceResponseFormat,
  }
}

export function materializeInterpretedPlanningWorkflowBatchInput<
  T extends {
    workflowKey?: string
    reuseTaskRef?: string
    reuseGroupKey?: string
    inferRemainingAnswers?: boolean
    answers?: InterpretablePlanningAnswer[]
    workflows: readonly InterpretablePlanningWorkflowLeafCarrier[]
  },
>(
  input: T,
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
): MaterializedPlanningWorkflowBatchCarrier<T> {
  const followThrough = {
    kind: 'workflow_batch' as const,
    workflowKey: input.workflowKey,
    reuseTaskRef: input.reuseTaskRef,
    reuseGroupKey: input.reuseGroupKey,
    inferRemainingAnswers: input.inferRemainingAnswers,
    answers: input.answers,
    workflows: [...input.workflows] as InterpretableDecisionWorkflowLeafFollowThroughInput[],
  }
  const resolvedSourceResponseFormat = resolveAutoPlanningSourceResponseFormat(
    followThrough,
    sourceResponse,
    answerSources,
    sourceResponseFormat,
  )
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, resolvedSourceResponseFormat)
  const materialized = materializeInterpretedDecisionFollowThrough(
    followThrough,
    sourceResponse,
    answerSources,
    resolvedSourceResponseFormat,
    interpretationState,
    false,
  )
  if (!materialized || materialized.kind !== 'workflow_batch') {
    throw new Error(
      `Expected materialized planning workflow batch for ${input.workflowKey ?? 'workflow_batch'}.`,
    )
  }
  assertNoUnusedExplicitlyRoutedAnswerSources({
    sourceResponse,
    answerSources,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning workflow batch "${input.workflowKey ?? 'workflow_batch'}"`,
  })
  assertDirectAnswerSourceFamilySourceResponseCompleteness({
    sourceResponse,
    answerSources,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning workflow batch "${input.workflowKey ?? 'workflow_batch'}"`,
  })
  assertDirectMatchingRunSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning workflow batch "${input.workflowKey ?? 'workflow_batch'}"`,
  })
  assertDirectLabelFamilySourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning workflow batch "${input.workflowKey ?? 'workflow_batch'}"`,
  })
  assertDirectQuestionAndTopicSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning workflow batch "${input.workflowKey ?? 'workflow_batch'}"`,
  })
  assertDirectOrderedSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning workflow batch "${input.workflowKey ?? 'workflow_batch'}"`,
  })
  assertDirectPendingSourceResponseCompleteness({
    sourceResponse,
    sourceResponseFormat: resolvedSourceResponseFormat,
    sourceResponseState: interpretationState,
    label: `planning workflow batch "${input.workflowKey ?? 'workflow_batch'}"`,
  })

  return {
    ...input,
    answers: materialized.answers,
    resolvedSourceResponseFormat,
    workflows: input.workflows.map((workflow, index) => ({
      ...workflow,
      answers: materialized.workflows[index]?.answers,
    })) as MaterializedPlanningWorkflowBatchCarrier<T>['workflows'],
  }
}

function mergeMaterializedPlanningAnswers(
  explicitAnswers: GoalPlanningRequestAnswer[] | undefined,
  inferredAnswers: GoalPlanningRequestAnswer[],
) {
  if (!explicitAnswers && inferredAnswers.length === 0) {
    return undefined
  }

  return [...(explicitAnswers ?? []), ...inferredAnswers]
}

function toAnswerCaptureFormat(
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
): AnswerCaptureFormat | undefined {
  if (!sourceResponseFormat || sourceResponseFormat === 'auto') {
    return undefined
  }
  return sourceResponseFormat
}

function finalizeMaterializedDecisionAnswers(
  answers: MaterializedInterpretedDecisionAnswer[],
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
) {
  const captureFormat = toAnswerCaptureFormat(sourceResponseFormat)
  if (!captureFormat) {
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }
  return answers.map((answer) => attachCaptureFormat(answer, captureFormat))
}

function finalizeMaterializedPlanningAnswers(
  answers: GoalPlanningRequestAnswer[],
  captureFormat?: AnswerCaptureFormat,
) {
  if (!captureFormat) {
    return answers
  }
  return answers.map((answer) => attachCaptureFormat(answer, captureFormat))
}

function attachCaptureFormat<T extends object>(
  value: T,
  captureFormat?: AnswerCaptureFormat,
): T & { captureFormat?: AnswerCaptureFormat } {
  if (!captureFormat) {
    return value as T & { captureFormat?: AnswerCaptureFormat }
  }
  Object.defineProperty(value, 'captureFormat', {
    value: captureFormat,
    enumerable: false,
    configurable: true,
    writable: true,
  })
  return value as T & { captureFormat?: AnswerCaptureFormat }
}

function materializeInterpretedPlanningAnswers(
  answers: InterpretablePlanningAnswer[] | undefined,
  sourceResponse?: string,
  answerSourcesByKey?: Map<string, string>,
  answerSourceGroupsByKey?: Map<string, string>,
  pendingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
  matchingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
  inferRemainingAnswers = false,
): GoalPlanningRequestAnswer[] | undefined {
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  const explicitAnswers = answers ?? []
  registerTopicAnchorCandidates(interpretationState, [
    ...explicitAnswers.map((answer) => buildPlanningAnswerSourceResponseCandidates(answer)),
  ])
  registerQuestionAnchorCandidateGroups(interpretationState, [
    ...explicitAnswers.map((answer) => buildPlanningAnswerSourceResponseCandidates(answer)),
  ])
  registerMatchingRunCandidateGroups(interpretationState, [
    ...explicitAnswers.map((answer) => buildPlanningAnswerSourceResponseCandidates(answer)),
  ])
  const materializedExplicitAnswers = explicitAnswers.map((answer) => {
    const resolved = resolveAnswerContent(
      answer.answer,
      answer.sourceExcerpt,
      answer.sourceOccurrence,
      answer.answerSourceKey,
      answer.answerSourceGroupKey,
      sourceResponse,
      `planner answer ${answer.summary}`,
      answerSourcesByKey,
      answerSourceGroupsByKey,
      pendingAnswerSourceEntries,
      matchingAnswerSourceEntries,
      sourceResponseFormat,
      buildPlanningAnswerSourceResponseCandidates(answer),
      interpretationState,
      buildPlanningPendingAnswerSourceConsumerDescriptor(answer),
      true,
    )

    return attachCaptureFormat(
      {
        summary: answer.summary,
        ...(answer.answerKey?.trim() ? { answerKey: answer.answerKey.trim() } : {}),
        ...(answer.summaryKey?.trim() ? { summaryKey: answer.summaryKey.trim() } : {}),
        ...(answer.prompt?.trim()
          ? { prompt: answer.prompt.trim() }
          : resolved.prompt
            ? { prompt: resolved.prompt }
            : {}),
        ...(answer.matchHints?.length ? { matchHints: answer.matchHints } : {}),
        answer: resolved.answer,
      },
      resolved.captureFormat,
    )
  })
  const inferredAnswers = inferRemainingAnswers
    ? materializeRemainingInterpretedPlanningAnswers(
        sourceResponse,
        sourceResponseFormat,
        interpretationState,
        pendingAnswerSourceEntries,
        matchingAnswerSourceEntries,
      )
    : []

  if (answers === undefined && inferredAnswers.length === 0) {
    return undefined
  }

  return [...materializedExplicitAnswers, ...inferredAnswers]
}

function materializeRemainingInterpretedPlanningAnswers(
  sourceResponse: string | undefined,
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  pendingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
  matchingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
) {
  const captureFormat = toAnswerCaptureFormat(sourceResponseFormat)
  if (
    sourceResponseFormat !== 'pending_answer_sources' &&
    sourceResponseFormat !== 'matching_answer_sources' &&
    sourceResponseFormat !== 'question_blocks' &&
    sourceResponseFormat !== 'question_clauses' &&
    sourceResponseFormat !== 'question_spans' &&
    sourceResponseFormat !== 'question_middle_spans' &&
    sourceResponseFormat !== 'question_closing_spans' &&
    sourceResponseFormat !== 'question_closing_blocks' &&
    sourceResponseFormat !== 'question_middle_blocks' &&
    sourceResponseFormat !== 'topic_clauses' &&
    sourceResponseFormat !== 'topic_sentences' &&
    sourceResponseFormat !== 'topic_spans' &&
    sourceResponseFormat !== 'topic_middle_spans' &&
    sourceResponseFormat !== 'topic_closing_spans' &&
    sourceResponseFormat !== 'topic_closing_blocks' &&
    sourceResponseFormat !== 'topic_paragraphs' &&
    sourceResponseFormat !== 'topic_middle_blocks' &&
    sourceResponseFormat !== 'topic_blocks'
  ) {
    throw new AnswerInterpretationError(
      'followThrough.inferRemainingAnswers requires sourceResponseFormat "pending_answer_sources", "matching_answer_sources", "question_blocks", "question_clauses", "question_spans", "question_middle_spans", "question_closing_spans", "question_closing_blocks", "question_middle_blocks", "topic_clauses", "topic_sentences", "topic_spans", "topic_middle_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", "topic_middle_blocks", or "topic_blocks".',
    )
  }

  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)

  if (sourceResponseFormat === 'pending_answer_sources') {
    const entries = parseRequiredPendingAnswerSourceEntries(
      pendingAnswerSourceEntries,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const nextIndex = interpretationState?.nextPendingAnswerSourceIndex ?? 0
    const groupedEntries = groupRemainingAnswerSourceEntries(
      entries.slice(nextIndex),
      new Set<number>(),
      'followThrough.inferRemainingAnswers',
      'pending',
      resolveRemainingMatchingPlanningAnswerSourceGroupDescriptor,
    )
    const answers = groupedEntries.map((groupedEntry) =>
      materializeRemainingPlanningAnswerFromAnswerSourceEntry(
        groupedEntry.entry,
        'followThrough.inferRemainingAnswers',
        captureFormat,
      ),
    )
    if (interpretationState) {
      interpretationState.nextPendingAnswerSourceIndex = entries.length
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'matching_answer_sources') {
    const entries = parseRequiredMatchingAnswerSourceEntries(
      matchingAnswerSourceEntries,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const consumedIndexes = interpretationState?.consumedMatchingAnswerSourceIndexes ?? new Set()
    const groupedEntries = groupRemainingAnswerSourceEntries(
      entries,
      consumedIndexes,
      'followThrough.inferRemainingAnswers',
      'matching',
      resolveRemainingMatchingPlanningAnswerSourceGroupDescriptor,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const groupedEntry of groupedEntries) {
      if (interpretationState) {
        for (const index of groupedEntry.indexes) {
          interpretationState.consumedMatchingAnswerSourceIndexes.add(index)
        }
      }
      answers.push(
        materializeRemainingPlanningAnswerFromAnswerSourceEntry(
          groupedEntry.entry,
          'followThrough.inferRemainingAnswers',
          captureFormat,
        ),
      )
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'question_blocks') {
    const blocks = parseRequiredQuestionSourceResponseBlocks(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, block] of blocks.entries()) {
      if (interpretationState?.consumedQuestionBlockIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedQuestionBlockIndexes.add(index)
      answers.push({
        summary: inferSummaryFromQuestionLabel(block.question),
        prompt: block.question,
        ...(captureFormat ? { captureFormat } : {}),
        answer: block.answer,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'question_clauses') {
    const clauses = parseRequiredQuestionSourceResponseClauses(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, clause] of clauses.entries()) {
      if (interpretationState?.consumedQuestionClauseIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedQuestionClauseIndexes.add(index)
      answers.push({
        summary: inferSummaryFromQuestionLabel(clause.question),
        prompt: clause.question,
        ...(captureFormat ? { captureFormat } : {}),
        answer: clause.answer,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'question_spans') {
    const spans = parseRequiredQuestionSourceResponseSpans(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, span] of spans.entries()) {
      if (interpretationState?.consumedQuestionSpanIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedQuestionSpanIndexes.add(index)
      answers.push({
        summary: inferSummaryFromQuestionLabel(span.question),
        prompt: span.question,
        ...(captureFormat ? { captureFormat } : {}),
        answer: span.answer,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'question_middle_spans') {
    const spans = parseRequiredQuestionSourceResponseMiddleSpans(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, span] of spans.entries()) {
      if (interpretationState?.consumedQuestionMiddleSpanIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedQuestionMiddleSpanIndexes.add(index)
      answers.push({
        summary: inferSummaryFromQuestionLabel(span.question),
        prompt: span.question,
        ...(captureFormat ? { captureFormat } : {}),
        answer: span.answer,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'question_closing_spans') {
    const spans = parseRequiredQuestionSourceResponseClosingSpans(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, span] of spans.entries()) {
      if (interpretationState?.consumedQuestionClosingSpanIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedQuestionClosingSpanIndexes.add(index)
      answers.push({
        summary: inferSummaryFromQuestionLabel(span.question),
        prompt: span.question,
        ...(captureFormat ? { captureFormat } : {}),
        answer: span.answer,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'question_closing_blocks') {
    const blocks = parseRequiredQuestionSourceResponseClosingBlocks(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, block] of blocks.entries()) {
      if (interpretationState?.consumedQuestionClosingBlockIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedQuestionClosingBlockIndexes.add(index)
      answers.push({
        summary: inferSummaryFromQuestionLabel(block.question),
        prompt: block.question,
        ...(captureFormat ? { captureFormat } : {}),
        answer: block.answer,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'question_middle_blocks') {
    const blocks = parseRequiredQuestionSourceResponseMiddleBlocks(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, block] of blocks.entries()) {
      if (interpretationState?.consumedQuestionMiddleBlockIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedQuestionMiddleBlockIndexes.add(index)
      answers.push({
        summary: inferSummaryFromQuestionLabel(block.question),
        prompt: block.question,
        ...(captureFormat ? { captureFormat } : {}),
        answer: block.answer,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'topic_clauses') {
    const clauses = parseRequiredTopicSourceResponseClauses(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, clause] of clauses.entries()) {
      if (interpretationState?.consumedTopicClauseIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedTopicClauseIndexes.add(index)
      assertTopicAnswerTextDoesNotContainQuestionAuthority(clause.text, 'Topic clause')
      const summary = inferTopicSummaryFromTopicSentence(clause.text)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        ...(captureFormat ? { captureFormat } : {}),
        answer: clause.text,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'topic_sentences') {
    const sentences = parseRequiredTopicSourceResponseSentences(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, sentence] of sentences.entries()) {
      if (interpretationState?.consumedTopicSentenceIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedTopicSentenceIndexes.add(index)
      assertTopicAnswerTextDoesNotContainQuestionAuthority(sentence.text, 'Topic sentence')
      const summary = inferTopicSummaryFromTopicSentence(sentence.text)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        ...(captureFormat ? { captureFormat } : {}),
        answer: sentence.text,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'topic_spans') {
    const spans = parseRequiredTopicSourceResponseSpans(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, span] of spans.entries()) {
      if (interpretationState?.consumedTopicSpanIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedTopicSpanIndexes.add(index)
      assertTopicAnswerTextDoesNotContainQuestionAuthority(span.text, 'Topic span')
      const summary = inferTopicSummaryFromTopicSpan(span)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        ...(captureFormat ? { captureFormat } : {}),
        answer: span.text,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'topic_middle_spans') {
    const spans = parseRequiredTopicSourceResponseMiddleSpans(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, span] of spans.entries()) {
      if (interpretationState?.consumedTopicMiddleSpanIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedTopicMiddleSpanIndexes.add(index)
      assertTopicAnswerTextDoesNotContainQuestionAuthority(span.text, 'Topic middle span')
      const summary = inferTopicSummaryFromTopicSpan(span)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        ...(captureFormat ? { captureFormat } : {}),
        answer: span.text,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'topic_closing_spans') {
    const spans = parseRequiredTopicSourceResponseClosingSpans(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, span] of spans.entries()) {
      if (interpretationState?.consumedTopicClosingSpanIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedTopicClosingSpanIndexes.add(index)
      assertTopicAnswerTextDoesNotContainQuestionAuthority(span.text, 'Topic closing span')
      const summary = inferTopicSummaryFromTopicClosingSpan(span)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        ...(captureFormat ? { captureFormat } : {}),
        answer: span.text,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'topic_closing_blocks') {
    const blocks = parseRequiredTopicSourceResponseClosingBlocks(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, block] of blocks.entries()) {
      if (interpretationState?.consumedTopicClosingBlockIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedTopicClosingBlockIndexes.add(index)
      assertTopicAnswerTextDoesNotContainQuestionAuthority(block.text, 'Topic closing block')
      const summary = inferTopicSummaryFromTopicClosingBlock(block)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        ...(captureFormat ? { captureFormat } : {}),
        answer: block.text,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'topic_paragraphs') {
    const paragraphs = parseRequiredTopicSourceResponseParagraphs(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, paragraph] of paragraphs.entries()) {
      if (interpretationState?.consumedTopicParagraphIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedTopicParagraphIndexes.add(index)
      assertTopicAnswerTextDoesNotContainQuestionAuthority(paragraph.text, 'Topic paragraph')
      const summary = inferTopicSummaryFromTopicParagraph(paragraph.text)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        ...(captureFormat ? { captureFormat } : {}),
        answer: paragraph.text,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  if (sourceResponseFormat === 'topic_middle_blocks') {
    const blocks = parseRequiredTopicSourceResponseMiddleBlocks(
      sourceResponse,
      'followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const answers: GoalPlanningRequestAnswer[] = []
    for (const [index, block] of blocks.entries()) {
      if (interpretationState?.consumedTopicMiddleBlockIndexes.has(index)) {
        continue
      }
      interpretationState?.consumedTopicMiddleBlockIndexes.add(index)
      assertTopicAnswerTextDoesNotContainQuestionAuthority(block.text, 'Topic middle block')
      const summary = inferTopicSummaryFromTopicBlock(block)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        ...(captureFormat ? { captureFormat } : {}),
        answer: block.text,
      })
    }
    return finalizeMaterializedPlanningAnswers(answers, captureFormat)
  }

  const blocks = parseRequiredTopicSourceResponseBlocks(
    sourceResponse,
    'followThrough.inferRemainingAnswers',
    interpretationState,
  )
  const answers: GoalPlanningRequestAnswer[] = []
  for (const [index, block] of blocks.entries()) {
    if (interpretationState?.consumedTopicBlockIndexes.has(index)) {
      continue
    }
    interpretationState?.consumedTopicBlockIndexes.add(index)
    assertTopicAnswerTextDoesNotContainQuestionAuthority(block.text, 'Topic block')
    const summary = inferTopicSummaryFromTopicBlock(block)
    answers.push({
      summary,
      prompt: synthesizeCanonicalPromptFromSummary(summary),
      ...(captureFormat ? { captureFormat } : {}),
      answer: block.text,
    })
  }
  return finalizeMaterializedPlanningAnswers(answers, captureFormat)
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

  const directExcerpt = resolveSourceExcerpt(sourceExcerpt, sourceOccurrence, sourceResponse, label)
  if (directExcerpt) {
    return { answer: directExcerpt }
  }

  const captureFormat = toAnswerCaptureFormat(sourceResponseFormat)
  const interpreted = (content: ResolvedAnswerContent): ResolvedAnswerContent =>
    captureFormat ? { ...content, captureFormat } : content

  const referencedSourceKey = answerSourceKey?.trim()
  const referencedSourceGroupKey = answerSourceGroupKey?.trim()
  if (referencedSourceKey && referencedSourceGroupKey) {
    throw new AnswerInterpretationError(
      `Provide only answerSourceKey or answerSourceGroupKey for ${label}.`,
    )
  }
  if (referencedSourceKey) {
    const sourced = answerSourcesByKey?.get(referencedSourceKey)
    if (!sourced) {
      throw new AnswerInterpretationError(
        `Unknown answerSourceKey "${referencedSourceKey}" for ${label}.`,
      )
    }
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      sourced,
      sourceResponseCandidates,
      `Named answerSource "${referencedSourceKey}" for ${label}`,
      'answerSource',
    )
    return interpreted({ answer: sourced })
  }
  if (referencedSourceGroupKey) {
    const sourced = answerSourceGroupsByKey?.get(referencedSourceGroupKey)
    if (!sourced) {
      throw new AnswerInterpretationError(
        `Unknown answerSourceGroupKey "${referencedSourceGroupKey}" for ${label}.`,
      )
    }
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      sourced,
      sourceResponseCandidates,
      `Named answerSource group "${referencedSourceGroupKey}" for ${label}`,
      'answerSource',
    )
    return interpreted({ answer: sourced })
  }

  if (sourceResponseFormat === 'labeled_sections') {
    return interpreted({
      answer: resolveLabeledSourceResponseSection(
        sourceResponse,
        sourceResponseCandidates,
        label,
        sourceResponseState,
      ),
    })
  }

  if (sourceResponseFormat === 'single_pending') {
    const resolvedAnswer = consumeSinglePendingSourceResponse(sourceResponse, label, sourceResponseState)
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Single pending reply for ${label}`,
      'sourceResponse',
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'pending_clauses') {
    const resolvedAnswer = resolvePendingSourceResponseClause(sourceResponse, label, sourceResponseState)
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Pending clause for ${label}`,
      'sourceResponse',
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'pending_paragraphs') {
    const resolvedAnswer = resolvePendingSourceResponseParagraph(
      sourceResponse,
      label,
      sourceResponseState,
    )
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Pending paragraph for ${label}`,
      'sourceResponse',
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'pending_sentences') {
    const resolvedAnswer = resolvePendingSourceResponseSentence(
      sourceResponse,
      label,
      sourceResponseState,
    )
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Pending sentence for ${label}`,
      'sourceResponse',
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'pending_conjunctions') {
    const resolvedAnswer = resolvePendingSourceResponseConjunction(
      sourceResponse,
      label,
      sourceResponseState,
    )
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Pending conjunction for ${label}`,
      'sourceResponse',
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'pending_answer_sources') {
    const resolvedAnswer = resolvePendingAnswerSourceValue(
      pendingAnswerSourceEntries,
      label,
      sourceResponseState,
      pendingAnswerSourceConsumerDescriptor,
    )
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Pending answerSource for ${label}`,
      'answerSource',
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'matching_answer_sources') {
    const resolvedAnswer = resolveMatchingAnswerSourceValue(
      matchingAnswerSourceEntries,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      pendingAnswerSourceConsumerDescriptor?.family,
    )
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Matching answerSource for ${label}`,
      'answerSource',
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'matching_runs') {
    const resolvedAnswer = resolveMatchingRunSourceResponseValue(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
    )
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Matching run for ${label}`,
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'matching_opening_runs') {
    const resolvedAnswer = resolveMatchingOpeningRunSourceResponseValue(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
    )
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Matching opening run for ${label}`,
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'matching_closing_runs') {
    const resolvedAnswer = resolveMatchingClosingRunSourceResponseValue(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
    )
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Matching closing run for ${label}`,
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'matching_middle_runs') {
    const resolvedAnswer = resolveMatchingMiddleRunSourceResponseValue(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
    )
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Matching middle run for ${label}`,
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'ordered_items') {
    const resolvedAnswer = resolveOrderedSourceResponseItem(sourceResponse, label, sourceResponseState)
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Ordered item for ${label}`,
      'sourceResponse',
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'ordered_blocks') {
    const resolvedAnswer = resolveOrderedSourceResponseBlock(sourceResponse, label, sourceResponseState)
    assertMatchedAnswerTextAuthorityMatchesConsumer(
      resolvedAnswer,
      sourceResponseCandidates,
      `Ordered block for ${label}`,
      'sourceResponse',
    )
    return interpreted({
      answer: resolvedAnswer,
    })
  }

  if (sourceResponseFormat === 'question_blocks') {
    const questionBlock = consumeQuestionBlockSourceResponseMatch(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!questionBlock) {
      throw new AnswerInterpretationError(`No question block matched ${label} in sourceResponse.`)
    }
    return interpreted({
      answer: questionBlock.answer,
      prompt: questionBlock.question,
    })
  }

  if (sourceResponseFormat === 'question_clauses') {
    const questionClause = consumeQuestionClauseSourceResponseMatch(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!questionClause) {
      throw new AnswerInterpretationError(`No question clause matched ${label} in sourceResponse.`)
    }
    return interpreted({
      answer: questionClause.answer,
      prompt: questionClause.question,
    })
  }

  if (sourceResponseFormat === 'question_spans') {
    const questionSpan = consumeQuestionSpanSourceResponseMatch(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!questionSpan) {
      throw new AnswerInterpretationError(`No question span matched ${label} in sourceResponse.`)
    }
    return interpreted({
      answer: questionSpan.answer,
      prompt: questionSpan.question,
    })
  }

  if (sourceResponseFormat === 'question_middle_spans') {
    const questionMiddleSpan = consumeQuestionMiddleSpanSourceResponseMatch(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!questionMiddleSpan) {
      throw new AnswerInterpretationError(
        `No question middle span matched ${label} in sourceResponse.`,
      )
    }
    return interpreted({
      answer: questionMiddleSpan.answer,
      prompt: questionMiddleSpan.question,
    })
  }

  if (sourceResponseFormat === 'question_closing_spans') {
    const questionClosingSpan = consumeQuestionClosingSpanSourceResponseMatch(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!questionClosingSpan) {
      throw new AnswerInterpretationError(
        `No question closing span matched ${label} in sourceResponse.`,
      )
    }
    return interpreted({
      answer: questionClosingSpan.answer,
      prompt: questionClosingSpan.question,
    })
  }

  if (sourceResponseFormat === 'question_closing_blocks') {
    const questionClosingBlock = consumeQuestionClosingBlockSourceResponseMatch(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!questionClosingBlock) {
      throw new AnswerInterpretationError(
        `No question closing block matched ${label} in sourceResponse.`,
      )
    }
    return interpreted({
      answer: questionClosingBlock.answer,
      prompt: questionClosingBlock.question,
    })
  }

  if (sourceResponseFormat === 'question_middle_blocks') {
    const questionMiddleBlock = consumeQuestionMiddleBlockSourceResponseMatch(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!questionMiddleBlock) {
      throw new AnswerInterpretationError(
        `No question middle block matched ${label} in sourceResponse.`,
      )
    }
    return interpreted({
      answer: questionMiddleBlock.answer,
      prompt: questionMiddleBlock.question,
    })
  }

  if (sourceResponseFormat === 'inline_topics') {
    return interpreted({
      answer: resolveInlineTopicSourceResponseSection(
        sourceResponse,
        sourceResponseCandidates,
        label,
        sourceResponseState,
      ),
    })
  }

  if (sourceResponseFormat === 'topic_clauses') {
    const topicClause = consumeTopicClauseSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
      rejectMultipleInferredTopicSummariesInTopicUnits,
    )
    if (!topicClause) {
      throw new AnswerInterpretationError(`No topic clause matched ${label} in sourceResponse.`)
    }
    return interpreted({ answer: topicClause })
  }

  if (sourceResponseFormat === 'topic_sentences') {
    const topicSentence = consumeTopicSentenceSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
      rejectMultipleInferredTopicSummariesInTopicUnits,
    )
    if (!topicSentence) {
      throw new AnswerInterpretationError(`No topic sentence matched ${label} in sourceResponse.`)
    }
    return interpreted({ answer: topicSentence })
  }

  if (sourceResponseFormat === 'topic_spans') {
    const topicSpan = consumeTopicSpanSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!topicSpan) {
      throw new AnswerInterpretationError(`No topic span matched ${label} in sourceResponse.`)
    }
    return interpreted({ answer: topicSpan })
  }

  if (sourceResponseFormat === 'topic_middle_spans') {
    const topicMiddleSpan = consumeTopicMiddleSpanSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!topicMiddleSpan) {
      throw new AnswerInterpretationError(
        `No topic middle span matched ${label} in sourceResponse.`,
      )
    }
    return interpreted({ answer: topicMiddleSpan })
  }

  if (sourceResponseFormat === 'topic_closing_spans') {
    const topicClosingSpan = consumeTopicClosingSpanSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!topicClosingSpan) {
      throw new AnswerInterpretationError(
        `No topic closing span matched ${label} in sourceResponse.`,
      )
    }
    return interpreted({ answer: topicClosingSpan })
  }

  if (sourceResponseFormat === 'topic_closing_blocks') {
    const topicClosingBlock = consumeTopicClosingBlockSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
      rejectMultipleInferredTopicSummariesInTopicUnits,
    )
    if (!topicClosingBlock) {
      throw new AnswerInterpretationError(
        `No topic closing block matched ${label} in sourceResponse.`,
      )
    }
    return interpreted({ answer: topicClosingBlock })
  }

  if (sourceResponseFormat === 'topic_paragraphs') {
    const topicParagraph = consumeTopicParagraphSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
      rejectMultipleInferredTopicSummariesInTopicUnits,
    )
    if (!topicParagraph) {
      throw new AnswerInterpretationError(`No topic paragraph matched ${label} in sourceResponse.`)
    }
    return interpreted({ answer: topicParagraph })
  }

  if (sourceResponseFormat === 'topic_middle_blocks') {
    const topicMiddleBlock = consumeTopicMiddleBlockSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
      rejectMultipleInferredTopicSummariesInTopicUnits,
    )
    if (!topicMiddleBlock) {
      throw new AnswerInterpretationError(
        `No topic middle block matched ${label} in sourceResponse.`,
      )
    }
    return interpreted({ answer: topicMiddleBlock })
  }

  if (sourceResponseFormat === 'topic_blocks') {
    const topicBlock = consumeTopicBlockSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
      rejectMultipleInferredTopicSummariesInTopicUnits,
    )
    if (!topicBlock) {
      throw new AnswerInterpretationError(`No topic block matched ${label} in sourceResponse.`)
    }
    return interpreted({ answer: topicBlock })
  }

  const shared = sourceResponse?.trim()
  if (shared) {
    return interpreted({ answer: shared })
  }

  throw new AnswerInterpretationError(
    `Missing answer text for ${label}. Provide item.answer, answerSourceKey, answerSourceGroupKey, or sourceResponse.`,
  )
}

function buildDecisionAnswerSourceResponseCandidates(
  answer: InterpretableDecisionAnswerEntryInput,
) {
  return dedupeNonEmptyStrings([
    humanizeSummaryKey(answer.summaryKey),
    humanizeDecisionKey(answer.decisionKey),
    answer.summary,
    answer.prompt,
    ...(answer.matchHints ?? []),
  ])
}

function buildPlanningAnswerSourceResponseCandidates(answer: InterpretablePlanningAnswer) {
  return dedupeNonEmptyStrings([
    humanizePlanningAnswerKey(answer.answerKey),
    humanizeSummaryKey(answer.summaryKey),
    answer.summary,
    answer.prompt,
    ...(answer.matchHints ?? []),
  ])
}

function buildAnswerSourceResponseCandidates(source: InterpretableAnswerSource) {
  return dedupeNonEmptyStrings([
    humanizeDecisionKey(source.decisionKey),
    humanizePlanningAnswerKey(source.answerKey),
    humanizeSummaryKey(source.summaryKey),
    humanizeAnswerSourceKey(source.answerSourceKey),
    source.summary,
    source.prompt,
    ...(source.matchHints ?? []),
  ])
}

function buildOpenDecisionSourceResponseCandidates(decision: InterpretableOpenDecision) {
  return dedupeNonEmptyStrings([
    humanizeSummaryKey(decision.summaryKey),
    humanizeDecisionKey(decision.decisionKey),
    decision.summary,
    decision.prompt,
    ...(decision.matchHints ?? []),
  ])
}

function resolveSourceExcerpt(
  sourceExcerpt: string | undefined,
  sourceOccurrence: number | undefined,
  sourceResponse: string | undefined,
  label: string,
) {
  const excerpt = sourceExcerpt?.trim()
  const occurrence = normalizeSourceExcerptOccurrence(sourceOccurrence, label, Boolean(excerpt))
  if (!excerpt) {
    return undefined
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(`sourceExcerpt for ${label} requires sourceResponse.`)
  }
  const occurrences = listSourceExcerptOccurrences(shared, excerpt)
  if (occurrences.length === 0) {
    throw new AnswerInterpretationError(
      `sourceExcerpt for ${label} was not found in sourceResponse.`,
    )
  }
  if (occurrence === undefined) {
    if (occurrences.length > 1) {
      throw new AnswerInterpretationError(
        `sourceExcerpt for ${label} matched ${occurrences.length} occurrences in sourceResponse. Provide sourceOccurrence to disambiguate.`,
      )
    }
    return excerpt
  }
  if (occurrence > occurrences.length) {
    throw new AnswerInterpretationError(
      `sourceExcerpt for ${label} requested sourceOccurrence ${occurrence} but only ${occurrences.length} occurrences were found in sourceResponse.`,
    )
  }
  return excerpt
}

function normalizeSourceExcerptOccurrence(
  sourceOccurrence: number | undefined,
  label: string,
  hasSourceExcerpt: boolean,
) {
  if (sourceOccurrence === undefined) {
    return undefined
  }
  if (!hasSourceExcerpt) {
    throw new AnswerInterpretationError(`sourceOccurrence for ${label} requires sourceExcerpt.`)
  }
  if (!Number.isInteger(sourceOccurrence) || sourceOccurrence < 1) {
    throw new AnswerInterpretationError(`sourceOccurrence for ${label} must be a positive integer.`)
  }
  return sourceOccurrence
}

function listSourceExcerptOccurrences(sourceResponse: string, sourceExcerpt: string) {
  const occurrences: number[] = []
  let nextIndex = 0
  while (nextIndex <= sourceResponse.length - sourceExcerpt.length) {
    const matchIndex = sourceResponse.indexOf(sourceExcerpt, nextIndex)
    if (matchIndex === -1) {
      break
    }
    occurrences.push(matchIndex)
    nextIndex = matchIndex + sourceExcerpt.length
  }
  return occurrences
}

function resolveLabeledSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const sectionsByLabel = parseRequiredLabeledSourceResponseSections(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const match = findLabeledSourceResponseSectionEntry(
    sectionsByLabel,
    candidates,
    sourceResponseState?.consumedLabeledSectionLabels,
  )
  if (match) {
    assertLabeledValueAuthorityMatchesLabel(
      match.label,
      match.value,
      'Labeled section',
      'value text',
    )
    return match.value
  }

  throw new AnswerInterpretationError(`No labeled section matched ${label} in sourceResponse.`)
}

function resolveInlineTopicSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const sectionsByLabel = parseRequiredInlineTopicSections(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const match = findLabeledSourceResponseSectionEntry(
    sectionsByLabel,
    candidates,
    sourceResponseState?.consumedInlineTopicLabels,
  )
  if (match) {
    assertLabeledValueAuthorityMatchesLabel(
      match.label,
      match.value,
      'Inline topic clause',
      'answer text',
    )
    return match.value
  }

  throw new AnswerInterpretationError(`No inline topic clause matched ${label} in sourceResponse.`)
}

function consumeSinglePendingSourceResponse(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.singlePendingConsumed) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat single_pending requires exactly one pending answer consumer.',
    )
  }

  const shared = sourceResponse?.trim()
  const normalizedShared = shared ? normalizeGenericPendingOrMatchingUnitText(shared) : undefined
  if (!normalizedShared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat single_pending requires sourceResponse for ${label}.`,
    )
  }

  if (sourceResponseState) {
    sourceResponseState.singlePendingConsumed = true
  }

  return normalizedShared
}

function resolvePendingSourceResponseClause(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const clauses = parseRequiredPendingSourceResponseClauses(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const nextIndex = sourceResponseState?.nextPendingClauseIndex ?? 0
  const nextClause = clauses[nextIndex]
  if (!nextClause) {
    throw new AnswerInterpretationError(
      `No pending clause remained for ${label} in sourceResponse.`,
    )
  }
  if (sourceResponseState) {
    sourceResponseState.nextPendingClauseIndex = nextIndex + 1
  }
  return nextClause
}

function resolvePendingSourceResponseParagraph(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const paragraphs = parseRequiredPendingSourceResponseParagraphs(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const nextIndex = sourceResponseState?.nextPendingParagraphIndex ?? 0
  const nextParagraph = paragraphs[nextIndex]
  if (!nextParagraph) {
    throw new AnswerInterpretationError(
      `No pending paragraph remained for ${label} in sourceResponse.`,
    )
  }
  if (sourceResponseState) {
    sourceResponseState.nextPendingParagraphIndex = nextIndex + 1
  }
  return nextParagraph
}

function resolvePendingSourceResponseSentence(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const sentences = parseRequiredPendingSourceResponseSentences(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const nextIndex = sourceResponseState?.nextPendingSentenceIndex ?? 0
  const nextSentence = sentences[nextIndex]
  if (!nextSentence) {
    throw new AnswerInterpretationError(
      `No pending sentence remained for ${label} in sourceResponse.`,
    )
  }
  if (sourceResponseState) {
    sourceResponseState.nextPendingSentenceIndex = nextIndex + 1
  }
  return nextSentence
}

function resolvePendingSourceResponseConjunction(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const conjunctions = parseRequiredPendingSourceResponseConjunctions(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const nextIndex = sourceResponseState?.nextPendingConjunctionIndex ?? 0
  const nextConjunction = conjunctions[nextIndex]
  if (!nextConjunction) {
    throw new AnswerInterpretationError(
      `No pending conjunction segment remained for ${label} in sourceResponse.`,
    )
  }
  if (sourceResponseState) {
    sourceResponseState.nextPendingConjunctionIndex = nextIndex + 1
  }
  return nextConjunction
}

function resolvePendingAnswerSourceValue(
  pendingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
  consumerDescriptor?: PendingAnswerSourceConsumerDescriptor,
) {
  const entries = parseRequiredPendingAnswerSourceEntries(
    pendingAnswerSourceEntries,
    label,
    sourceResponseState,
  )
  const nextIndex = sourceResponseState?.nextPendingAnswerSourceIndex ?? 0
  const nextEntry = entries[nextIndex]
  if (!nextEntry) {
    throw new AnswerInterpretationError(`No pending answer source remained for ${label}.`)
  }
  const firstExplicitAuthorities = listPendingAnswerSourceEntryAuthorities(nextEntry)
  const firstHasGroupingAuthority = entryHasPendingAnswerSourceGroupingAuthority(nextEntry)

  if (firstExplicitAuthorities.length === 0) {
    if (consumerDescriptor) {
      const laterAuthority = findNonContiguousPendingAnswerSourceAuthority(
        entries,
        nextIndex + 1,
        consumerDescriptor,
      )
      if (laterAuthority) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat pending_answer_sources found non-contiguous explicit ${laterAuthority} for ${label}.`,
        )
      }
    }
    if (sourceResponseState) {
      sourceResponseState.nextPendingAnswerSourceIndex = nextIndex + 1
    }
    return nextEntry.answer
  }

  if (!consumerDescriptor) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat pending_answer_sources found explicit ${formatPendingAnswerSourceAuthorityLabels(firstExplicitAuthorities)} before ${label}.`,
    )
  }

  if (!entryMatchesPendingAnswerSourceConsumer(nextEntry, consumerDescriptor)) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat pending_answer_sources found explicit ${formatPendingAnswerSourceAuthorityLabels(firstExplicitAuthorities)} before ${label}.`,
    )
  }

  if (!firstHasGroupingAuthority) {
    if (sourceResponseState) {
      sourceResponseState.nextPendingAnswerSourceIndex = nextIndex + 1
    }
    return nextEntry.answer
  }

  let endIndex = nextIndex + 1
  while (endIndex < entries.length) {
    const candidateEntry = entries[endIndex]
    if (!candidateEntry) {
      break
    }
    const candidateAuthorities = listPendingAnswerSourceEntryAuthorities(candidateEntry)
    if (candidateAuthorities.length === 0) {
      break
    }
    if (!entryHasPendingAnswerSourceGroupingAuthority(candidateEntry)) {
      break
    }
    if (!entryMatchesPendingAnswerSourceConsumer(candidateEntry, consumerDescriptor)) {
      break
    }
    endIndex += 1
  }

  const laterAuthority = findNonContiguousPendingAnswerSourceAuthority(
    entries,
    endIndex,
    consumerDescriptor,
  )
  if (laterAuthority) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat pending_answer_sources found non-contiguous explicit ${laterAuthority} for ${label}.`,
    )
  }

  if (sourceResponseState) {
    sourceResponseState.nextPendingAnswerSourceIndex = endIndex
  }
  return entries
    .slice(nextIndex, endIndex)
    .map((entry) => entry.answer)
    .join('\n\n')
}

function materializeRemainingPlanningAnswerFromAnswerSourceEntry(
  entry: ResolvedAnswerSourceEntry,
  label: string,
  captureFormat?: AnswerCaptureFormat,
): GoalPlanningRequestAnswer {
  const summary = resolveRequiredAnswerSourceSummary(entry, label)
  const inferredSummaryKey = shouldDeriveSummaryKeyFromAnswerSourceKey(entry)
    ? inferSummaryKeyFromStableAnswerSourceKey(entry.key)
    : undefined
  return attachCaptureFormat(
    {
      summary,
      ...(entry.answerKey?.trim() ? { answerKey: entry.answerKey.trim() } : {}),
      ...(entry.summaryKey?.trim()
        ? { summaryKey: entry.summaryKey.trim() }
        : inferredSummaryKey
          ? { summaryKey: inferredSummaryKey }
          : {}),
      prompt: entry.prompt?.trim() || synthesizeCanonicalPromptFromSummary(summary),
      ...(entry.matchHints?.length ? { matchHints: entry.matchHints } : {}),
      answer: entry.answer,
    },
    captureFormat,
  )
}

function buildDecisionPendingAnswerSourceConsumerDescriptor(input: {
  decisionKey?: string
  summaryKey?: string
}): PendingAnswerSourceConsumerDescriptor {
  const keys = [
    input.decisionKey?.trim() ? `decisionKey:${input.decisionKey.trim()}` : undefined,
    input.summaryKey?.trim() ? `summaryKey:${input.summaryKey.trim()}` : undefined,
  ].filter((key): key is string => Boolean(key))

  return { family: 'decision', keys }
}

function buildPlanningPendingAnswerSourceConsumerDescriptor(input: {
  answerKey?: string
  summaryKey?: string
}): PendingAnswerSourceConsumerDescriptor {
  const keys = [
    input.answerKey?.trim() ? `answerKey:${input.answerKey.trim()}` : undefined,
    input.summaryKey?.trim() ? `summaryKey:${input.summaryKey.trim()}` : undefined,
  ].filter((key): key is string => Boolean(key))

  return { family: 'planning', keys }
}

function formatAnswerSourceRouteLabel(route: RemainingAnswerSourceRoute | undefined) {
  return route ? `route "${route}"` : undefined
}

function listPendingAnswerSourceEntryAuthorities(entry: ResolvedAnswerSourceEntry) {
  return [
    formatAnswerSourceRouteLabel(entry.route),
    entry.decisionKey?.trim() ? `decisionKey "${entry.decisionKey.trim()}"` : undefined,
    entry.answerKey?.trim() ? `answerKey "${entry.answerKey.trim()}"` : undefined,
    entry.summaryKey?.trim() ? `summaryKey "${entry.summaryKey.trim()}"` : undefined,
  ].filter((authority): authority is string => Boolean(authority))
}

function listPendingAnswerSourceEntryGroupingAuthorityKeys(entry: ResolvedAnswerSourceEntry) {
  return [
    entry.decisionKey?.trim() ? `decisionKey:${entry.decisionKey.trim()}` : undefined,
    entry.answerKey?.trim() ? `answerKey:${entry.answerKey.trim()}` : undefined,
    entry.summaryKey?.trim() ? `summaryKey:${entry.summaryKey.trim()}` : undefined,
  ].filter((authority): authority is string => Boolean(authority))
}

function formatPendingAnswerSourceAuthorityLabels(authorities: string[]) {
  if (authorities.length <= 1) {
    return authorities[0] ?? 'authority'
  }
  if (authorities.length === 2) {
    return `${authorities[0]} and ${authorities[1]}`
  }
  return `${authorities.slice(0, -1).join(', ')}, and ${authorities.at(-1)}`
}

function entryMatchesPendingAnswerSourceConsumer(
  entry: ResolvedAnswerSourceEntry,
  consumerDescriptor: PendingAnswerSourceConsumerDescriptor,
) {
  if (entry.route && entry.route !== consumerDescriptor.family) {
    return false
  }

  const authorityKeys = listPendingAnswerSourceEntryGroupingAuthorityKeys(entry)
  if (authorityKeys.length === 0) {
    return true
  }

  return (
    consumerDescriptor.keys.length > 0 &&
    authorityKeys.every((key) => consumerDescriptor.keys.includes(key))
  )
}

function entryHasPendingAnswerSourceGroupingAuthority(entry: ResolvedAnswerSourceEntry) {
  return listPendingAnswerSourceEntryGroupingAuthorityKeys(entry).length > 0
}

function findNonContiguousPendingAnswerSourceAuthority(
  entries: ResolvedAnswerSourceEntry[],
  startIndex: number,
  consumerDescriptor: PendingAnswerSourceConsumerDescriptor,
) {
  for (let index = startIndex; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) {
      continue
    }
    if (
      entryHasPendingAnswerSourceGroupingAuthority(entry) &&
      entryMatchesPendingAnswerSourceConsumer(entry, consumerDescriptor)
    ) {
      return formatPendingAnswerSourceAuthorityLabels(
        listPendingAnswerSourceEntryAuthorities(entry),
      )
    }
  }
  return undefined
}

function mergeAnswerSourceMetadataValue(
  currentValue: string | undefined,
  nextValue: string | undefined,
  fieldLabel: string,
  label: string,
  areEqual: (left: string, right: string) => boolean = (left, right) => left === right,
) {
  const current = currentValue?.trim() || undefined
  const next = nextValue?.trim() || undefined
  if (!current) {
    return next
  }
  if (!next) {
    return current
  }
  if (!areEqual(current, next)) {
    throw new AnswerInterpretationError(
      `Conflicting ${fieldLabel} values in answerSources for ${label}.`,
    )
  }
  return current
}

function mergeAnswerSourceEntries(
  entries: ResolvedAnswerSourceEntry[],
  label: string,
): ResolvedAnswerSourceEntry {
  const [firstEntry, ...restEntries] = entries
  if (!firstEntry) {
    throw new AnswerInterpretationError(`No answerSources remained for ${label}.`)
  }

  let mergedEntry: ResolvedAnswerSourceEntry = {
    ...firstEntry,
    sourceKeys: [...firstEntry.sourceKeys],
    ...(firstEntry.matchHints?.length
      ? { matchHints: [...firstEntry.matchHints] }
      : { matchHints: undefined }),
    candidates: [...firstEntry.candidates],
  }
  const answers = [firstEntry.answer]

  for (const entry of restEntries) {
    answers.push(entry.answer)
    mergedEntry = {
      ...mergedEntry,
      sourceGroupKey: mergeAnswerSourceMetadataValue(
        mergedEntry.sourceGroupKey,
        entry.sourceGroupKey,
        'sourceGroupKey',
        label,
      ),
      route: mergeAnswerSourceMetadataValue(mergedEntry.route, entry.route, 'route', label) as
        | RemainingAnswerSourceRoute
        | undefined,
      decisionKey: mergeAnswerSourceMetadataValue(
        mergedEntry.decisionKey,
        entry.decisionKey,
        'decisionKey',
        label,
      ),
      answerKey: mergeAnswerSourceMetadataValue(
        mergedEntry.answerKey,
        entry.answerKey,
        'answerKey',
        label,
      ),
      summaryKey: mergeAnswerSourceMetadataValue(
        mergedEntry.summaryKey,
        entry.summaryKey,
        'summaryKey',
        label,
      ),
      summary: mergeAnswerSourceMetadataValue(
        mergedEntry.summary,
        entry.summary,
        'summary',
        label,
        (left, right) => normalizeSourceResponseLabel(left) === normalizeSourceResponseLabel(right),
      ),
      prompt: mergeAnswerSourceMetadataValue(mergedEntry.prompt, entry.prompt, 'prompt', label),
      matchHints: dedupeNonEmptyStrings([
        ...(mergedEntry.matchHints ?? []),
        ...(entry.matchHints ?? []),
      ]),
      sourceKeys: dedupeNonEmptyStrings([...mergedEntry.sourceKeys, ...entry.sourceKeys]),
      candidates: dedupeNonEmptyStrings([...mergedEntry.candidates, ...entry.candidates]),
    }
  }

  return {
    ...mergedEntry,
    key: mergedEntry.sourceGroupKey ?? mergedEntry.key,
    answer: answers.join('\n\n'),
  }
}

function createFallbackAnswerSourceGroupDescriptor(
  entry: ResolvedAnswerSourceEntry,
): RemainingAnswerSourceGroupDescriptor {
  return {
    key: `answerSourceKey:${entry.key}`,
    label: `answerSourceKey "${entry.key}"`,
  }
}

function resolveRemainingMatchingDecisionAnswerSourceGroupDescriptor(
  entry: ResolvedAnswerSourceEntry,
): RemainingAnswerSourceGroupDescriptor | undefined {
  const decisionKey = entry.decisionKey?.trim()
  if (decisionKey) {
    return {
      key: `decisionKey:${decisionKey}`,
      label: `decisionKey "${decisionKey}"`,
    }
  }

  const summaryKey = entry.summaryKey?.trim()
  if (summaryKey) {
    return {
      key: `summaryKey:${summaryKey}`,
      label: `summaryKey "${summaryKey}"`,
    }
  }

  return undefined
}

function resolveRemainingMatchingPlanningAnswerSourceGroupDescriptor(
  entry: ResolvedAnswerSourceEntry,
): RemainingAnswerSourceGroupDescriptor | undefined {
  const answerKey = entry.answerKey?.trim()
  if (answerKey) {
    return {
      key: `answerKey:${answerKey}`,
      label: `answerKey "${answerKey}"`,
    }
  }

  const summaryKey = entry.summaryKey?.trim()
  if (summaryKey) {
    return {
      key: `summaryKey:${summaryKey}`,
      label: `summaryKey "${summaryKey}"`,
    }
  }

  return undefined
}

function groupRemainingAnswerSourceEntries(
  entries: ResolvedAnswerSourceEntry[],
  consumedIndexes: Set<number>,
  label: string,
  sourceFamilyLabel: 'matching' | 'pending',
  resolveGroupDescriptor: (
    entry: ResolvedAnswerSourceEntry,
  ) => RemainingAnswerSourceGroupDescriptor | undefined,
): GroupedAnswerSourceEntry[] {
  const groups: Array<{
    descriptor?: RemainingAnswerSourceGroupDescriptor
    indexes: number[]
    entries: ResolvedAnswerSourceEntry[]
  }> = []
  const seenDescriptorKeys = new Set<string>()

  for (const [index, entry] of entries.entries()) {
    if (consumedIndexes.has(index)) {
      continue
    }

    const descriptor = resolveGroupDescriptor(entry)
    const currentGroup = groups.at(-1)
    if (descriptor && currentGroup?.descriptor?.key === descriptor.key) {
      currentGroup.indexes.push(index)
      currentGroup.entries.push(entry)
      continue
    }

    if (descriptor && seenDescriptorKeys.has(descriptor.key)) {
      throw new AnswerInterpretationError(
        `Non-contiguous ${sourceFamilyLabel} answerSources repeated ${descriptor.label} for ${label}.`,
      )
    }

    if (descriptor) {
      seenDescriptorKeys.add(descriptor.key)
    }
    groups.push({
      descriptor,
      indexes: [index],
      entries: [entry],
    })
  }

  return groups.map((group) => ({
    indexes: group.indexes,
    entry:
      group.entries.length === 1 && group.entries[0]
        ? group.entries[0]
        : mergeAnswerSourceEntries(group.entries, label),
  }))
}

function resolveRemainingMixedAnswerSourceRoute(entry: ResolvedAnswerSourceEntry): {
  route: RemainingAnswerSourceRoute
  descriptor: RemainingAnswerSourceGroupDescriptor
} {
  const route = entry.route
  const decisionKey = entry.decisionKey?.trim()
  const answerKey = entry.answerKey?.trim()

  if (decisionKey && answerKey) {
    throw new AnswerInterpretationError(
      `Remaining answerSource "${entry.key}" cannot target both decisionKey "${decisionKey}" and answerKey "${answerKey}" when inferDecisionTopics is combined with followThrough.inferRemainingAnswers.`,
    )
  }

  if (route === 'decision' && answerKey) {
    throw new AnswerInterpretationError(
      `Remaining answerSource "${entry.key}" cannot combine route "decision" with answerKey "${answerKey}" when inferDecisionTopics is combined with followThrough.inferRemainingAnswers.`,
    )
  }

  if (route === 'planning' && decisionKey) {
    throw new AnswerInterpretationError(
      `Remaining answerSource "${entry.key}" cannot combine route "planning" with decisionKey "${decisionKey}" when inferDecisionTopics is combined with followThrough.inferRemainingAnswers.`,
    )
  }

  if (route === 'decision') {
    return {
      route,
      descriptor:
        resolveRemainingMatchingDecisionAnswerSourceGroupDescriptor(entry) ??
        createFallbackAnswerSourceGroupDescriptor(entry),
    }
  }

  if (route === 'planning') {
    return {
      route,
      descriptor:
        resolveRemainingMatchingPlanningAnswerSourceGroupDescriptor(entry) ??
        createFallbackAnswerSourceGroupDescriptor(entry),
    }
  }

  if (decisionKey) {
    return {
      route: 'decision',
      descriptor: {
        key: `decisionKey:${decisionKey}`,
        label: `decisionKey "${decisionKey}"`,
      },
    }
  }

  if (answerKey) {
    return {
      route: 'planning',
      descriptor: {
        key: `answerKey:${answerKey}`,
        label: `answerKey "${answerKey}"`,
      },
    }
  }

  throw new AnswerInterpretationError(
    `Remaining answerSource "${entry.key}" requires explicit route, decisionKey, or answerKey when inferDecisionTopics is combined with followThrough.inferRemainingAnswers.`,
  )
}

function groupMixedRemainingAnswerSourceEntries(
  entries: ResolvedAnswerSourceEntry[],
  consumedIndexes: Set<number>,
  sourceFamilyLabel: 'matching' | 'pending',
): RoutedGroupedAnswerSourceEntry[] {
  const groups: Array<{
    route: RemainingAnswerSourceRoute
    descriptor: RemainingAnswerSourceGroupDescriptor
    indexes: number[]
    entries: ResolvedAnswerSourceEntry[]
  }> = []
  const seenDescriptorKeys = new Set<string>()

  for (const [index, entry] of entries.entries()) {
    if (consumedIndexes.has(index)) {
      continue
    }

    const { route, descriptor } = resolveRemainingMixedAnswerSourceRoute(entry)
    const currentGroup = groups.at(-1)
    if (
      currentGroup &&
      currentGroup.route === route &&
      currentGroup.descriptor.key === descriptor.key
    ) {
      currentGroup.indexes.push(index)
      currentGroup.entries.push(entry)
      continue
    }

    if (seenDescriptorKeys.has(descriptor.key)) {
      throw new AnswerInterpretationError(
        `Non-contiguous ${sourceFamilyLabel} answerSources repeated ${descriptor.label} for mixed remaining answer inference.`,
      )
    }

    seenDescriptorKeys.add(descriptor.key)
    groups.push({
      route,
      descriptor,
      indexes: [index],
      entries: [entry],
    })
  }

  return groups.map((group) => ({
    route: group.route,
    indexes: group.indexes,
    entry:
      group.entries.length === 1 && group.entries[0]
        ? group.entries[0]
        : mergeAnswerSourceEntries(
            group.entries,
            'inferDecisionTopics + followThrough.inferRemainingAnswers',
          ),
  }))
}

function resolveMatchingAnswerSourceValue(
  matchingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
  consumerFamily?: RemainingAnswerSourceRoute,
) {
  const matchingEntries = resolveMatchingAnswerSourceEntries(
    matchingAnswerSourceEntries,
    candidates,
    label,
    sourceResponseState,
    consumerFamily,
  )
  return matchingEntries.map((entry) => entry.answer).join('\n\n')
}

function resolveMatchingAnswerSourceEntries(
  matchingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
  consumerFamily?: RemainingAnswerSourceRoute,
) {
  const entries = parseRequiredMatchingAnswerSourceEntries(
    matchingAnswerSourceEntries,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedMatchingAnswerSourceIndexes ?? new Set()
  const matchingIndexes = findMatchingAnswerSourceEntryIndexes(
    entries,
    candidates,
    consumedIndexes,
    consumerFamily,
  )

  const contiguousIndexes = resolveContiguousMatchingAnswerSourceIndexes(matchingIndexes, label)
  if (contiguousIndexes.length === 0) {
    throw new AnswerInterpretationError(`No answerSource matched ${label}.`)
  }

  if (sourceResponseState) {
    for (const index of contiguousIndexes) {
      sourceResponseState.consumedMatchingAnswerSourceIndexes.add(index)
    }
  }
  return contiguousIndexes.map((index) => {
    const matchingEntry = entries[index]
    if (!matchingEntry) {
      throw new AnswerInterpretationError(`No answerSource matched ${label}.`)
    }
    return matchingEntry
  })
}

function resolveContiguousMatchingAnswerSourceIndexes(matchingIndexes: number[], label: string) {
  if (matchingIndexes.length <= 1) {
    return matchingIndexes
  }

  for (let index = 1; index < matchingIndexes.length; index += 1) {
    const previousIndex = matchingIndexes[index - 1]
    const currentIndex = matchingIndexes[index]
    if (previousIndex === undefined || currentIndex === undefined) {
      throw new AnswerInterpretationError(`Multiple answerSources matched ${label}.`)
    }
    if (currentIndex !== previousIndex + 1) {
      throw new AnswerInterpretationError(`Multiple answerSources matched ${label}.`)
    }
  }

  return matchingIndexes
}

function resolveMatchingRunSourceResponseValue(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const runs = parseMatchingSourceResponseRuns(sourceResponse, label, sourceResponseState)
  const candidateGroupIndex = resolveMatchingRunCandidateGroupIndex(
    candidates,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedMatchingRunIndexes ?? new Set<number>()
  const matchingIndexes = runs.flatMap((run, index) => {
    if (consumedIndexes.has(index)) {
      return []
    }
    return run.candidateGroupIndex === candidateGroupIndex ? [index] : []
  })

  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(`Multiple matching runs matched ${label}.`)
  }

  const matchingIndex = matchingIndexes[0]
  if (matchingIndex === undefined) {
    throw new AnswerInterpretationError(`No matching run matched ${label} in sourceResponse.`)
  }

  if (sourceResponseState) {
    sourceResponseState.consumedMatchingRunIndexes.add(matchingIndex)
  }

  const matchingRun = runs[matchingIndex]
  if (!matchingRun) {
    throw new AnswerInterpretationError(`No matching run matched ${label} in sourceResponse.`)
  }

  return matchingRun.text
}

function resolveMatchingOpeningRunSourceResponseValue(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const runs = parseMatchingOpeningSourceResponseRuns(sourceResponse, label, sourceResponseState)
  const candidateGroupIndex = resolveMatchingRunCandidateGroupIndex(
    candidates,
    label,
    sourceResponseState,
  )
  const consumedIndexes =
    sourceResponseState?.consumedMatchingOpeningRunIndexes ?? new Set<number>()
  const matchingIndexes = runs.flatMap((run, index) => {
    if (consumedIndexes.has(index)) {
      return []
    }
    return run.candidateGroupIndex === candidateGroupIndex ? [index] : []
  })

  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(`Multiple matching opening runs matched ${label}.`)
  }

  const matchingIndex = matchingIndexes[0]
  if (matchingIndex === undefined) {
    throw new AnswerInterpretationError(
      `No matching opening run matched ${label} in sourceResponse.`,
    )
  }

  if (sourceResponseState) {
    sourceResponseState.consumedMatchingOpeningRunIndexes.add(matchingIndex)
  }

  const matchingRun = runs[matchingIndex]
  if (!matchingRun) {
    throw new AnswerInterpretationError(
      `No matching opening run matched ${label} in sourceResponse.`,
    )
  }

  return matchingRun.text
}

function resolveMatchingClosingRunSourceResponseValue(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const runs = parseMatchingClosingSourceResponseRuns(sourceResponse, label, sourceResponseState)
  const candidateGroupIndex = resolveMatchingRunCandidateGroupIndex(
    candidates,
    label,
    sourceResponseState,
  )
  const consumedIndexes =
    sourceResponseState?.consumedMatchingClosingRunIndexes ?? new Set<number>()
  const matchingIndexes = runs.flatMap((run, index) => {
    if (consumedIndexes.has(index)) {
      return []
    }
    return run.candidateGroupIndex === candidateGroupIndex ? [index] : []
  })

  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(`Multiple matching closing runs matched ${label}.`)
  }

  const matchingIndex = matchingIndexes[0]
  if (matchingIndex === undefined) {
    throw new AnswerInterpretationError(
      `No matching closing run matched ${label} in sourceResponse.`,
    )
  }

  if (sourceResponseState) {
    sourceResponseState.consumedMatchingClosingRunIndexes.add(matchingIndex)
  }

  const matchingRun = runs[matchingIndex]
  if (!matchingRun) {
    throw new AnswerInterpretationError(
      `No matching closing run matched ${label} in sourceResponse.`,
    )
  }

  return matchingRun.text
}

function resolveMatchingMiddleRunSourceResponseValue(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const runs = parseMatchingMiddleSourceResponseRuns(sourceResponse, label, sourceResponseState)
  const candidateGroupIndex = resolveMatchingRunCandidateGroupIndex(
    candidates,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedMatchingMiddleRunIndexes ?? new Set<number>()
  const matchingIndexes = runs.flatMap((run, index) => {
    if (consumedIndexes.has(index)) {
      return []
    }
    return run.candidateGroupIndex === candidateGroupIndex ? [index] : []
  })

  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(`Multiple matching middle runs matched ${label}.`)
  }

  const matchingIndex = matchingIndexes[0]
  if (matchingIndex === undefined) {
    throw new AnswerInterpretationError(
      `No matching middle run matched ${label} in sourceResponse.`,
    )
  }

  if (sourceResponseState) {
    sourceResponseState.consumedMatchingMiddleRunIndexes.add(matchingIndex)
  }

  const matchingRun = runs[matchingIndex]
  if (!matchingRun) {
    throw new AnswerInterpretationError(
      `No matching middle run matched ${label} in sourceResponse.`,
    )
  }

  return matchingRun.text
}

function materializeMixedRemainingAnswerSourceInference(input: {
  sourceResponse?: string
  answerSources?: InterpretableAnswerSource[]
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined
  sourceResponseState: InterpretedSourceResponseState | undefined
  knownDecisions: InterpretableKnownDecision[]
}) {
  const captureFormat = toAnswerCaptureFormat(input.sourceResponseFormat)
  if (!supportsMixedRemainingAnswerSourceInference(input.sourceResponseFormat)) {
    throw new AnswerInterpretationError(
      'followThrough.inferRemainingAnswers can only be combined with inferDecisionTopics when sourceResponseFormat is "pending_answer_sources" or "matching_answer_sources" and the remaining answerSources are explicitly routed by route, decisionKey, or answerKey.',
    )
  }

  const resolvedAnswerSources = createResolvedAnswerSources(
    input.answerSources,
    input.sourceResponse,
  )
  const interpretationState =
    input.sourceResponseState ??
    createInterpretedSourceResponseState(input.sourceResponse, input.sourceResponseFormat)

  if (input.sourceResponseFormat === 'pending_answer_sources') {
    const entries = parseRequiredPendingAnswerSourceEntries(
      resolvedAnswerSources?.entries,
      'inferDecisionTopics + followThrough.inferRemainingAnswers',
      interpretationState,
    )
    const nextIndex = interpretationState?.nextPendingAnswerSourceIndex ?? 0
    const groupedEntries = groupMixedRemainingAnswerSourceEntries(
      entries.slice(nextIndex),
      new Set<number>(),
      'pending',
    )
    if (interpretationState) {
      interpretationState.nextPendingAnswerSourceIndex = entries.length
    }
    return {
      decisionAnswers: materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
        groupedEntries.filter((entry) => entry.route === 'decision').map((entry) => entry.entry),
        input.knownDecisions,
        'inferDecisionTopics',
        captureFormat,
      ),
      planningAnswers: groupedEntries
        .filter((entry) => entry.route === 'planning')
        .map((entry) =>
          materializeRemainingPlanningAnswerFromAnswerSourceEntry(
            entry.entry,
            'followThrough.inferRemainingAnswers',
            captureFormat,
          ),
        ),
    }
  }

  const entries = parseRequiredMatchingAnswerSourceEntries(
    resolvedAnswerSources?.entries,
    'inferDecisionTopics + followThrough.inferRemainingAnswers',
    interpretationState,
  )
  const consumedIndexes = interpretationState?.consumedMatchingAnswerSourceIndexes ?? new Set()
  const groupedEntries = groupMixedRemainingAnswerSourceEntries(
    entries,
    consumedIndexes,
    'matching',
  )
  if (interpretationState) {
    for (const groupedEntry of groupedEntries) {
      for (const index of groupedEntry.indexes) {
        interpretationState.consumedMatchingAnswerSourceIndexes.add(index)
      }
    }
  }
  return {
    decisionAnswers: materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
      groupedEntries.filter((entry) => entry.route === 'decision').map((entry) => entry.entry),
      input.knownDecisions,
      'inferDecisionTopics',
      captureFormat,
    ),
    planningAnswers: groupedEntries
      .filter((entry) => entry.route === 'planning')
      .map((entry) =>
        materializeRemainingPlanningAnswerFromAnswerSourceEntry(
          entry.entry,
          'followThrough.inferRemainingAnswers',
          captureFormat,
        ),
      ),
  }
}

function resolveMatchingRunCandidateGroupIndex(
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  registerMatchingRunCandidateGroups(sourceResponseState, [candidates])
  const groupKey = buildMatchingRunCandidateGroupKey(candidates)
  const groupIndex = groupKey
    ? sourceResponseState?.matchingRunCandidateLookup?.get(groupKey)
    : undefined

  if (groupIndex === undefined) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_runs could not register candidate group for ${label}.`,
    )
  }

  return groupIndex
}

function parseMatchingSourceResponseRuns(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const cachedRuns = sourceResponseState?.matchingRuns
  if (cachedRuns) {
    return cachedRuns
  }

  const candidateGroups = sourceResponseState?.matchingRunCandidateGroups ?? []
  if (candidateGroups.length === 0) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_runs requires registered candidate groups for ${label}.`,
    )
  }

  const { units, joiner } = parseMatchingRunSourceResponseUnits(sourceResponse, label)
  const runs: MatchingSourceResponseRun[] = []
  let leadingTexts: string[] = []
  let pendingGapTexts: string[] = []
  let currentRun: MatchingSourceResponseRun | undefined

  for (const unit of units) {
    const matchingGroupIndexes = findMatchingRunGroupIndexes(unit, candidateGroups)
    if (matchingGroupIndexes.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple matching runs matched unit "${unit.text}" in sourceResponse.`,
      )
    }

    const matchingGroupIndex = matchingGroupIndexes[0]
    if (matchingGroupIndex === undefined) {
      if (currentRun) {
        pendingGapTexts.push(unit.text)
      } else {
        leadingTexts.push(unit.text)
      }
      continue
    }

    if (!currentRun) {
      if (leadingTexts.length > 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_runs found unmatched prose before the first matched run.',
        )
      }
      currentRun = {
        text: unit.text,
        candidateGroupIndex: matchingGroupIndex,
      }
      leadingTexts = []
      continue
    }

    if (currentRun.candidateGroupIndex === matchingGroupIndex) {
      currentRun.text =
        pendingGapTexts.length > 0
          ? `${currentRun.text}${joiner}${pendingGapTexts.join(joiner)}${joiner}${unit.text}`
          : `${currentRun.text}${joiner}${unit.text}`
      pendingGapTexts = []
      continue
    }

    if (pendingGapTexts.length > 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_runs found unmatched prose between different matched consumers.',
      )
    }

    runs.push(currentRun)
    currentRun = {
      text: unit.text,
      candidateGroupIndex: matchingGroupIndex,
    }
  }

  if (!currentRun) {
    throw new AnswerInterpretationError(
      `No matching run matched any candidate group for ${label} in sourceResponse.`,
    )
  }

  if (pendingGapTexts.length > 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat matching_runs found unmatched prose after the last matched run.',
    )
  }

  runs.push(currentRun)
  if (sourceResponseState) {
    sourceResponseState.matchingRuns = runs
  }
  return runs
}

function parseMatchingOpeningSourceResponseRuns(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const cachedRuns = sourceResponseState?.matchingOpeningRuns
  if (cachedRuns) {
    return cachedRuns
  }

  const candidateGroups = sourceResponseState?.matchingRunCandidateGroups ?? []
  if (candidateGroups.length === 0) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_opening_runs requires registered candidate groups for ${label}.`,
    )
  }

  const shared = sourceResponse?.trim()
  const sentenceCount = shared ? parseTopicSourceResponseSentences(shared).length : 0
  const { units, joiner, unitLabel } = parseMatchingRunSourceResponseUnits(sourceResponse, label)
  if (sentenceCount === 1) {
    const embeddedRuns = parseEmbeddedMatchingOpeningSourceResponseRuns(
      sourceResponse,
      label,
      candidateGroups,
    )
    if (embeddedRuns) {
      if (sourceResponseState) {
        sourceResponseState.matchingOpeningRuns = embeddedRuns
      }
      return embeddedRuns
    }
  }

  const runs: MatchingSourceResponseRun[] = []
  const leadingTexts: string[] = []
  let currentMatchedTexts: string[] = []
  let currentCandidateGroupIndex: number | undefined
  let trailingTexts: string[] = []

  for (const unit of units) {
    const matchingGroupIndexes = findMatchingRunGroupIndexes(unit, candidateGroups)
    if (matchingGroupIndexes.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple matching opening runs matched unit "${unit.text}" in sourceResponse.`,
      )
    }

    const matchingGroupIndex = matchingGroupIndexes[0]
    if (matchingGroupIndex === undefined) {
      if (currentCandidateGroupIndex === undefined) {
        leadingTexts.push(unit.text)
      } else {
        trailingTexts.push(unit.text)
      }
      continue
    }

    if (currentCandidateGroupIndex === undefined) {
      if (leadingTexts.length > 0) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat matching_opening_runs requires each run to start with a matched anchor before any leading ${unitLabel}.`,
        )
      }
      currentCandidateGroupIndex = matchingGroupIndex
      currentMatchedTexts = [unit.text]
      trailingTexts = []
      continue
    }

    if (trailingTexts.length === 0) {
      if (currentCandidateGroupIndex === matchingGroupIndex) {
        currentMatchedTexts.push(unit.text)
        continue
      }
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_opening_runs requires at least one trailing ${unitLabel} before the next matched anchor.`,
      )
    }

    if (currentCandidateGroupIndex === matchingGroupIndex) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_opening_runs does not allow a matched anchor for the same consumer after trailing ${unitLabel} has started.`,
      )
    }

    runs.push({
      text: [...currentMatchedTexts, ...trailingTexts].join(joiner),
      candidateGroupIndex: currentCandidateGroupIndex,
    })
    currentCandidateGroupIndex = matchingGroupIndex
    currentMatchedTexts = [unit.text]
    trailingTexts = []
  }

  if (currentCandidateGroupIndex === undefined) {
    throw new AnswerInterpretationError(
      `No matching opening run matched any candidate group for ${label} in sourceResponse.`,
    )
  }

  if (trailingTexts.length === 0) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_opening_runs requires each run to end with at least one trailing ${unitLabel} after the matched anchor.`,
    )
  }

  runs.push({
    text: [...currentMatchedTexts, ...trailingTexts].join(joiner),
    candidateGroupIndex: currentCandidateGroupIndex,
  })

  if (sourceResponseState) {
    sourceResponseState.matchingOpeningRuns = runs
  }
  return runs
}

function parseEmbeddedMatchingOpeningSourceResponseRuns(
  sourceResponse: string | undefined,
  label: string,
  candidateGroups: string[][],
) {
  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_opening_runs requires sourceResponse for ${label}.`,
    )
  }

  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(shared)
  if (tokens.length === 0) {
    return undefined
  }

  const anchors = resolveEmbeddedMatchingRunAnchors(
    shared,
    tokens,
    candidateGroups,
    'matching_opening_runs',
  )
  if (anchors.length === 0) {
    return undefined
  }

  if (anchors[0]?.startTokenIndex !== 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat matching_opening_runs requires each run to start with a matched anchor before any leading sentence.',
    )
  }

  const runs: MatchingSourceResponseRun[] = []
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as EmbeddedMatchingRunAnchor
    const nextAnchor = anchors[index + 1]

    if (nextAnchor) {
      if (nextAnchor.startTokenIndex < anchor.endTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_opening_runs found overlapping embedded anchors for different matched consumers.',
        )
      }
      if (nextAnchor.startTokenIndex === anchor.endTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_opening_runs requires at least one trailing sentence before the next matched anchor.',
        )
      }
    } else if (anchor.endTokenIndex >= tokens.length) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_opening_runs requires each run to end with at least one trailing sentence after the matched anchor.',
      )
    }

    const endOriginal = nextAnchor?.startOriginal ?? shared.length
    runs.push({
      text: normalizeEmbeddedMatchingRunText(shared.slice(anchor.startOriginal, endOriginal)),
      candidateGroupIndex: anchor.candidateGroupIndex,
    })
  }

  return runs
}

function resolveEmbeddedMatchingRunAnchors(
  sourceResponse: string,
  tokens: EmbeddedMatchingRunToken[],
  candidateGroups: string[][],
  sourceResponseFormat:
    | 'matching_opening_runs'
    | 'matching_closing_runs'
    | 'matching_middle_runs',
) {
  const anchors: EmbeddedMatchingRunAnchor[] = []

  candidateGroups.forEach((candidateGroup, candidateGroupIndex) => {
    const matches = collapseEmbeddedMatchingRunRanges(
      findEmbeddedMatchingRunTokenRanges(tokens, candidateGroup),
    )
    if (matches.length > 1) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} found multiple embedded anchors for the same matched consumer.`,
      )
    }
    const match = matches[0]
    if (!match) {
      return
    }
    anchors.push({
      candidateGroupIndex,
      startTokenIndex: match.startTokenIndex,
      endTokenIndex: match.endTokenIndex,
      startOriginal: tokens[match.startTokenIndex]?.start ?? 0,
      endOriginal: tokens[match.endTokenIndex - 1]?.end ?? sourceResponse.length,
    })
  })

  anchors.sort((left, right) => left.startTokenIndex - right.startTokenIndex)
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1] as EmbeddedMatchingRunAnchor
    const current = anchors[index] as EmbeddedMatchingRunAnchor
    if (current.startTokenIndex < previous.endTokenIndex) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} found overlapping embedded anchors for different matched consumers.`,
      )
    }
  }

  return anchors
}

function resolveEmbeddedQuestionAnchors(
  sourceResponse: string,
  tokens: EmbeddedMatchingRunToken[],
  candidateGroups: string[][],
  sourceResponseFormat: 'question_spans' | 'question_middle_spans' | 'question_closing_spans',
) {
  const anchors: EmbeddedMatchingRunAnchor[] = []

  candidateGroups.forEach((candidateGroup, candidateGroupIndex) => {
    const matches = collapseEmbeddedMatchingRunRanges(
      findEmbeddedMatchingRunTokenRanges(tokens, candidateGroup),
    )
    if (matches.length > 1) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} found multiple embedded anchors for the same matched question.`,
      )
    }
    const match = matches[0]
    if (!match) {
      return
    }
    anchors.push({
      candidateGroupIndex,
      startTokenIndex: match.startTokenIndex,
      endTokenIndex: match.endTokenIndex,
      startOriginal: tokens[match.startTokenIndex]?.start ?? 0,
      endOriginal: tokens[match.endTokenIndex - 1]?.end ?? sourceResponse.length,
    })
  })

  anchors.sort((left, right) => left.startTokenIndex - right.startTokenIndex)
  for (let index = 1; index < anchors.length; index += 1) {
    const previous = anchors[index - 1] as EmbeddedMatchingRunAnchor
    const current = anchors[index] as EmbeddedMatchingRunAnchor
    if (current.startTokenIndex < previous.endTokenIndex) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} found overlapping embedded anchors for different matched questions.`,
      )
    }
  }

  return anchors
}

function resolveEmbeddedQuestionAnchorsWithInferredCandidates(
  sourceResponse: string,
  tokens: EmbeddedMatchingRunToken[],
  candidateGroups: string[][],
  sourceResponseFormat: 'question_spans' | 'question_middle_spans' | 'question_closing_spans',
) {
  const explicitCandidateGroups = filterEmbeddedQuestionCandidateGroups(candidateGroups)
  const explicitAnchors = explicitCandidateGroups.length
    ? resolveEmbeddedQuestionAnchors(
        sourceResponse,
        tokens,
        explicitCandidateGroups,
        sourceResponseFormat,
      )
    : []
  const inferredCandidateGroups = inferEmbeddedCanonicalQuestionCandidateGroups(
    sourceResponse,
    tokens,
  )
  const inferredAnchors = inferredCandidateGroups.length
    ? resolveEmbeddedQuestionAnchors(
        sourceResponse,
        tokens,
        inferredCandidateGroups,
        sourceResponseFormat,
      )
    : []

  if (explicitAnchors.length === 0) {
    return inferredAnchors
  }
  if (inferredAnchors.length === 0) {
    return explicitAnchors
  }

  const merged = [...explicitAnchors]
  for (const inferredAnchor of inferredAnchors) {
    const duplicate = merged.some(
      (anchor) =>
        anchor.startTokenIndex === inferredAnchor.startTokenIndex &&
        anchor.endTokenIndex === inferredAnchor.endTokenIndex,
    )
    if (!duplicate) {
      merged.push(inferredAnchor)
    }
  }

  merged.sort((left, right) => left.startTokenIndex - right.startTokenIndex)
  for (let index = 1; index < merged.length; index += 1) {
    const previous = merged[index - 1] as EmbeddedMatchingRunAnchor
    const current = merged[index] as EmbeddedMatchingRunAnchor
    if (current.startTokenIndex < previous.endTokenIndex) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} found overlapping embedded anchors for different matched questions.`,
      )
    }
  }

  return merged
}

function resolveEmbeddedTopicAnchors(
  sourceResponse: string,
  tokens: EmbeddedMatchingRunToken[],
  candidateLabels: string[],
  sourceResponseFormat: 'topic_spans' | 'topic_middle_spans' | 'topic_closing_spans',
) {
  const anchors: EmbeddedTopicAnchor[] = []

  candidateLabels.forEach((candidateLabel) => {
    const normalizedLabel = normalizeSourceResponseText(candidateLabel)
    if (!normalizedLabel) {
      return
    }

    const matches = collapseEmbeddedMatchingRunRanges(
      findEmbeddedMatchingRunTokenRanges(tokens, [candidateLabel]),
    )
    if (matches.length > 1) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} found multiple embedded anchors for the same topic label.`,
      )
    }

    const match = matches[0]
    if (!match) {
      return
    }

    anchors.push({
      normalizedLabel,
      startTokenIndex: match.startTokenIndex,
      endTokenIndex: match.endTokenIndex,
      startOriginal: tokens[match.startTokenIndex]?.start ?? 0,
      endOriginal: tokens[match.endTokenIndex - 1]?.end ?? sourceResponse.length,
    })
  })

  anchors.sort((left, right) => left.startTokenIndex - right.startTokenIndex)
  const filteredAnchors: EmbeddedTopicAnchor[] = []
  for (const anchor of anchors) {
    const previous = filteredAnchors[filteredAnchors.length - 1]
    if (!previous || anchor.startTokenIndex >= previous.endTokenIndex) {
      filteredAnchors.push(anchor)
      continue
    }

    const previousContainsCurrent = normalizedTopicLabelContainsLabel(
      previous.normalizedLabel,
      anchor.normalizedLabel,
    )
    const currentContainsPrevious = normalizedTopicLabelContainsLabel(
      anchor.normalizedLabel,
      previous.normalizedLabel,
    )
    if (previousContainsCurrent && !currentContainsPrevious) {
      filteredAnchors[filteredAnchors.length - 1] = anchor
      continue
    }
    if (currentContainsPrevious && !previousContainsCurrent) {
      continue
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat ${sourceResponseFormat} found overlapping embedded topic anchors for different topic labels.`,
    )
  }

  return filteredAnchors
}

function collapseEmbeddedMatchingRunRanges(
  ranges: Array<{ startTokenIndex: number; endTokenIndex: number }>,
) {
  if (ranges.length <= 1) {
    return ranges
  }

  const sorted = [...ranges].sort((left, right) => left.startTokenIndex - right.startTokenIndex)
  const collapsed: Array<{ startTokenIndex: number; endTokenIndex: number }> = []

  for (const range of sorted) {
    const previous = collapsed[collapsed.length - 1]
    if (!previous || range.startTokenIndex >= previous.endTokenIndex) {
      collapsed.push({ ...range })
      continue
    }
    previous.startTokenIndex = Math.min(previous.startTokenIndex, range.startTokenIndex)
    previous.endTokenIndex = Math.max(previous.endTokenIndex, range.endTokenIndex)
  }

  return collapsed
}

function findEmbeddedMatchingRunTokenRanges(
  tokens: EmbeddedMatchingRunToken[],
  candidateGroup: string[],
) {
  const ranges = new Map<string, { startTokenIndex: number; endTokenIndex: number }>()

  for (const candidate of candidateGroup) {
    const normalizedCandidate = normalizeSourceResponseText(candidate)
    const normalizedCandidateCore = normalizeQuestionPromptCore(candidate)
    const sequences = dedupeNonEmptyStrings([normalizedCandidate, normalizedCandidateCore])
    for (const sequence of sequences) {
      const candidateTokens = sequence.split(' ').filter(Boolean)
      if (candidateTokens.length === 0) {
        continue
      }
      for (
        let startTokenIndex = 0;
        startTokenIndex <= tokens.length - candidateTokens.length;
        startTokenIndex += 1
      ) {
        const matches = candidateTokens.every(
          (token, offset) => tokens[startTokenIndex + offset]?.normalizedText === token,
        )
        if (!matches) {
          continue
        }
        const endTokenIndex = startTokenIndex + candidateTokens.length
        ranges.set(`${startTokenIndex}:${endTokenIndex}`, {
          startTokenIndex,
          endTokenIndex,
        })
      }
    }
  }

  return [...ranges.values()].sort((left, right) => left.startTokenIndex - right.startTokenIndex)
}

const EMBEDDED_MATCHING_RUN_APOSTROPHE_T_CONTRACTIONS = new Map([
  ['aren', "aren't"],
  ['can', "can't"],
  ['couldn', "couldn't"],
  ['didn', "didn't"],
  ['don', "don't"],
  ['doesn', "doesn't"],
  ['hadn', "hadn't"],
  ['haven', "haven't"],
  ['hasn', "hasn't"],
  ['isn', "isn't"],
  ['mayn', "mayn't"],
  ['mightn', "mightn't"],
  ['mustn', "mustn't"],
  ['needn', "needn't"],
  ['oughtn', "oughtn't"],
  ['shan', "shan't"],
  ['shouldn', "shouldn't"],
  ['wasn', "wasn't"],
  ['weren', "weren't"],
  ['won', "won't"],
  ['wouldn', "wouldn't"],
])

const EMBEDDED_MATCHING_RUN_APOSTROPHE_EXISTENTIAL_STARTER_CONTRACTIONS = new Map([
  ['d', "there'd"],
  ['ll', "there'll"],
  ['ve', "there've"],
])

const EMBEDDED_MATCHING_RUN_APOSTROPHE_EXISTENTIAL_COPULA_CONTRACTIONS = new Map([
  ['re', "there're"],
  ['s', "there's"],
])

function tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse: string) {
  const tokens: EmbeddedMatchingRunToken[] = []
  const pattern = /[a-z0-9]+/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(sourceResponse)) !== null) {
    const normalizedText = match[0].toLowerCase()
    const previousToken = tokens[tokens.length - 1]
    const separator = previousToken
      ? sourceResponse.slice(previousToken.end, match.index)
      : ''
    const mergedContractedNegative =
      normalizedText === 't' && /['’]/u.test(separator)
        ? EMBEDDED_MATCHING_RUN_APOSTROPHE_T_CONTRACTIONS.get(
            previousToken?.normalizedText ?? '',
          )
        : undefined
    const mergedExistentialStarter =
      previousToken?.normalizedText === 'there' && /['’]/u.test(separator)
        ? EMBEDDED_MATCHING_RUN_APOSTROPHE_EXISTENTIAL_STARTER_CONTRACTIONS.get(normalizedText)
        : undefined
    const mergedExistentialCopula =
      previousToken?.normalizedText === 'there' && /['’]/u.test(separator)
        ? EMBEDDED_MATCHING_RUN_APOSTROPHE_EXISTENTIAL_COPULA_CONTRACTIONS.get(normalizedText)
        : undefined

    if (previousToken && mergedContractedNegative) {
      previousToken.normalizedText = mergedContractedNegative
      previousToken.end = match.index + match[0].length
      continue
    }

    if (previousToken && mergedExistentialStarter) {
      previousToken.normalizedText = mergedExistentialStarter
      previousToken.end = match.index + match[0].length
      continue
    }

    if (previousToken && mergedExistentialCopula) {
      previousToken.normalizedText = mergedExistentialCopula
      previousToken.end = match.index + match[0].length
      continue
    }

    tokens.push({
      normalizedText,
      start: match.index,
      end: match.index + match[0].length,
    })
  }

  return tokens
}

function parseMatchingClosingSourceResponseRuns(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const cachedRuns = sourceResponseState?.matchingClosingRuns
  if (cachedRuns) {
    return cachedRuns
  }

  const candidateGroups = sourceResponseState?.matchingRunCandidateGroups ?? []
  if (candidateGroups.length === 0) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_closing_runs requires registered candidate groups for ${label}.`,
    )
  }

  const shared = sourceResponse?.trim()
  const sentenceCount = shared ? parseTopicSourceResponseSentences(shared).length : 0
  const { units, joiner, unitLabel } = parseMatchingRunSourceResponseUnits(sourceResponse, label)
  if (sentenceCount === 1) {
    const embeddedRuns = parseEmbeddedMatchingClosingSourceResponseRuns(
      sourceResponse,
      label,
      candidateGroups,
    )
    if (embeddedRuns) {
      if (sourceResponseState) {
        sourceResponseState.matchingClosingRuns = embeddedRuns
      }
      return embeddedRuns
    }
  }

  const runs: MatchingSourceResponseRun[] = []
  let leadingTexts: string[] = []
  let currentMatchedTexts: string[] = []
  let currentCandidateGroupIndex: number | undefined

  for (const unit of units) {
    const matchingGroupIndexes = findMatchingRunGroupIndexes(unit, candidateGroups)
    if (matchingGroupIndexes.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple matching closing runs matched unit "${unit.text}" in sourceResponse.`,
      )
    }

    const matchingGroupIndex = matchingGroupIndexes[0]
    if (matchingGroupIndex === undefined) {
      if (currentCandidateGroupIndex === undefined) {
        leadingTexts.push(unit.text)
      } else {
        runs.push({
          text: [...leadingTexts, ...currentMatchedTexts].join(joiner),
          candidateGroupIndex: currentCandidateGroupIndex,
        })
        leadingTexts = [unit.text]
        currentMatchedTexts = []
        currentCandidateGroupIndex = undefined
      }
      continue
    }

    if (currentCandidateGroupIndex === undefined) {
      if (leadingTexts.length === 0) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat matching_closing_runs requires each run to start with at least one leading ${unitLabel} before the matched anchor.`,
        )
      }
      currentCandidateGroupIndex = matchingGroupIndex
      currentMatchedTexts = [unit.text]
      continue
    }

    if (currentCandidateGroupIndex === matchingGroupIndex) {
      currentMatchedTexts.push(unit.text)
      continue
    }

    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_closing_runs requires at least one leading ${unitLabel} before the next matched anchor.`,
    )
  }

  if (currentCandidateGroupIndex === undefined) {
    if (runs.length === 0) {
      throw new AnswerInterpretationError(
        `No matching closing run matched any candidate group for ${label} in sourceResponse.`,
      )
    }
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_closing_runs requires each run to end with a matched anchor after at least one leading ${unitLabel}.`,
    )
  }

  runs.push({
    text: [...leadingTexts, ...currentMatchedTexts].join(joiner),
    candidateGroupIndex: currentCandidateGroupIndex,
  })

  if (sourceResponseState) {
    sourceResponseState.matchingClosingRuns = runs
  }
  return runs
}

function parseEmbeddedMatchingClosingSourceResponseRuns(
  sourceResponse: string | undefined,
  label: string,
  candidateGroups: string[][],
) {
  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_closing_runs requires sourceResponse for ${label}.`,
    )
  }

  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(shared)
  if (tokens.length === 0) {
    return undefined
  }

  const anchors = resolveEmbeddedMatchingRunAnchors(
    shared,
    tokens,
    candidateGroups,
    'matching_closing_runs',
  )
  if (anchors.length === 0) {
    return undefined
  }

  if (anchors[0]?.startTokenIndex === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat matching_closing_runs requires each run to start with at least one leading sentence before the matched anchor.',
    )
  }

  const runs: MatchingSourceResponseRun[] = []
  let previousEndTokenIndex = 0
  let previousEndOriginal = 0

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as EmbeddedMatchingRunAnchor
    const nextAnchor = anchors[index + 1]
    const nextTokenStartOriginal = tokens[anchor.endTokenIndex]?.start ?? shared.length

    if (anchor.startTokenIndex <= previousEndTokenIndex) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_closing_runs found overlapping embedded anchors for different matched consumers.',
      )
    }

    if (nextAnchor) {
      if (nextAnchor.startTokenIndex < anchor.endTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_closing_runs found overlapping embedded anchors for different matched consumers.',
        )
      }
      if (nextAnchor.startTokenIndex === anchor.endTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_closing_runs requires at least one leading sentence before the next matched anchor.',
        )
      }
    } else if (anchor.endTokenIndex < tokens.length) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_closing_runs requires each run to end with a matched anchor after at least one leading sentence.',
      )
    }

    runs.push({
      text: normalizeEmbeddedMatchingRunText(
        shared.slice(previousEndOriginal, nextTokenStartOriginal),
      ),
      candidateGroupIndex: anchor.candidateGroupIndex,
    })
    previousEndTokenIndex = anchor.endTokenIndex
    previousEndOriginal = nextTokenStartOriginal
  }

  return runs
}

function parseMatchingMiddleSourceResponseRuns(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const cachedRuns = sourceResponseState?.matchingMiddleRuns
  if (cachedRuns) {
    return cachedRuns
  }

  const candidateGroups = sourceResponseState?.matchingRunCandidateGroups ?? []
  if (candidateGroups.length === 0) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_middle_runs requires registered candidate groups for ${label}.`,
    )
  }

  const shared = sourceResponse?.trim()
  const sentenceCount = shared ? parseTopicSourceResponseSentences(shared).length : 0
  const { units, joiner, unitLabel } = parseMatchingRunSourceResponseUnits(sourceResponse, label)
  if (sentenceCount === 1) {
    const embeddedRuns = parseEmbeddedMatchingMiddleSourceResponseRuns(
      sourceResponse,
      label,
      candidateGroups,
    )
    if (embeddedRuns) {
      if (sourceResponseState) {
        sourceResponseState.matchingMiddleRuns = embeddedRuns
      }
      return embeddedRuns
    }
  }

  const runs: MatchingSourceResponseRun[] = []
  let currentLeadingTexts: string[] = []
  let currentAnchor: { text: string; candidateGroupIndex: number } | undefined
  let trailingTexts: string[] = []

  for (const unit of units) {
    const matchingGroupIndexes = findMatchingRunGroupIndexes(unit, candidateGroups)
    if (matchingGroupIndexes.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple matching middle runs matched unit "${unit.text}" in sourceResponse.`,
      )
    }

    const matchingGroupIndex = matchingGroupIndexes[0]
    if (matchingGroupIndex === undefined) {
      if (!currentAnchor) {
        currentLeadingTexts.push(unit.text)
      } else {
        trailingTexts.push(unit.text)
      }
      continue
    }

    if (!currentAnchor) {
      if (currentLeadingTexts.length === 0) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat matching_middle_runs requires each run to start with at least one leading ${unitLabel} before the matched anchor.`,
        )
      }
      currentAnchor = {
        text: unit.text,
        candidateGroupIndex: matchingGroupIndex,
      }
      trailingTexts = []
      continue
    }

    if (trailingTexts.length < 2) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_middle_runs requires at least one trailing ${unitLabel} before the next matched anchor and at least one leading ${unitLabel} for that next run.`,
      )
    }

    runs.push({
      text: [...currentLeadingTexts, currentAnchor.text, ...trailingTexts.slice(0, -1)].join(
        joiner,
      ),
      candidateGroupIndex: currentAnchor.candidateGroupIndex,
    })
    currentLeadingTexts = [trailingTexts[trailingTexts.length - 1] as string]
    currentAnchor = {
      text: unit.text,
      candidateGroupIndex: matchingGroupIndex,
    }
    trailingTexts = []
  }

  if (!currentAnchor) {
    throw new AnswerInterpretationError(
      `No matching middle run matched any candidate group for ${label} in sourceResponse.`,
    )
  }

  if (trailingTexts.length === 0) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_middle_runs requires each run to end with at least one trailing ${unitLabel} after the matched anchor.`,
    )
  }

  runs.push({
    text: [...currentLeadingTexts, currentAnchor.text, ...trailingTexts].join(joiner),
    candidateGroupIndex: currentAnchor.candidateGroupIndex,
  })

  if (sourceResponseState) {
    sourceResponseState.matchingMiddleRuns = runs
  }
  return runs
}

function parseEmbeddedMatchingMiddleSourceResponseRuns(
  sourceResponse: string | undefined,
  label: string,
  candidateGroups: string[][],
) {
  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_middle_runs requires sourceResponse for ${label}.`,
    )
  }

  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(shared)
  if (tokens.length === 0) {
    return undefined
  }

  const anchors = resolveEmbeddedMatchingRunAnchors(
    shared,
    tokens,
    candidateGroups,
    'matching_middle_runs',
  )
  if (anchors.length === 0) {
    return undefined
  }

  if (anchors[0]?.startTokenIndex === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat matching_middle_runs requires each run to start with at least one leading sentence before the matched anchor.',
    )
  }

  const runs: MatchingSourceResponseRun[] = []
  let currentRunStartOriginal = 0

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as EmbeddedMatchingRunAnchor
    const nextAnchor = anchors[index + 1]
    const trailingTokenCount = tokens.length - anchor.endTokenIndex

    if (index === anchors.length - 1) {
      if (trailingTokenCount === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_middle_runs requires each run to end with at least one trailing sentence after the matched anchor.',
        )
      }
      runs.push({
        text: normalizeEmbeddedMatchingRunText(shared.slice(currentRunStartOriginal)),
        candidateGroupIndex: anchor.candidateGroupIndex,
      })
      break
    }

    if (!nextAnchor) {
      break
    }

    if (nextAnchor.startTokenIndex < anchor.endTokenIndex) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_middle_runs found overlapping embedded anchors for different matched consumers.',
      )
    }

    const gapTokenCount = nextAnchor.startTokenIndex - anchor.endTokenIndex
    if (gapTokenCount < 2) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_middle_runs requires at least one trailing sentence before the next matched anchor and at least one leading sentence for that next run.',
      )
    }

    const nextRunLeadingTokenStartOriginal =
      tokens[nextAnchor.startTokenIndex - 1]?.start ?? shared.length
    runs.push({
      text: normalizeEmbeddedMatchingRunText(
        shared.slice(currentRunStartOriginal, nextRunLeadingTokenStartOriginal),
      ),
      candidateGroupIndex: anchor.candidateGroupIndex,
    })
    currentRunStartOriginal = nextRunLeadingTokenStartOriginal
  }

  return runs
}

function parseMatchingRunSourceResponseUnits(sourceResponse: string | undefined, label: string) {
  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_runs requires sourceResponse for ${label}.`,
    )
  }

  const paragraphs = parseGenericMatchingSourceResponseParagraphUnits(shared)
  if (paragraphs.length > 1) {
    return { units: paragraphs, joiner: '\n\n', unitLabel: 'paragraph' }
  }

  const sentences = parseGenericMatchingSourceResponseSentenceUnits(shared)
  if (sentences.length > 1) {
    return { units: sentences, joiner: ' ', unitLabel: 'sentence' }
  }

  const clauses = parseGenericMatchingSourceResponseClauseUnits(shared)
  if (clauses.length > 1) {
    return { units: clauses, joiner: ', ', unitLabel: 'clause' }
  }

  const normalizedWholeReply = normalizeGenericPendingOrMatchingUnitText(shared)
  return {
    units: [
      {
        text: normalizedWholeReply || shared,
        normalizedText: normalizeSourceResponseText(normalizedWholeReply || shared),
      },
    ],
    joiner: ' ',
    unitLabel: 'sentence',
  }
}

function findMatchingRunGroupIndexes(
  unit: { normalizedText: string },
  candidateGroups: string[][],
) {
  return candidateGroups.flatMap((candidateGroup, index) =>
    findMatchingTopicTextUnitIndexes([unit], candidateGroup, new Set<number>()).length > 0
      ? [index]
      : [],
  )
}

function inferSummaryFromStableAnswerSourceEntryKey(entry: ResolvedAnswerSourceEntry) {
  if (entry.sourceKeys.length !== 1) {
    return undefined
  }
  return inferSummaryFromStableAnswerSourceKey(entry.sourceKeys[0])
}

function resolveRequiredAnswerSourceSummary(entry: ResolvedAnswerSourceEntry, label: string) {
  const summary = entry.summary?.trim()
  if (summary) {
    return summary
  }

  const summaryFromPrompt = inferSummaryFromStablePrompt(entry.prompt)
  if (summaryFromPrompt) {
    return summaryFromPrompt
  }

  const summaryFromDecisionKey = inferSummaryFromDecisionKey(entry.decisionKey)
  if (summaryFromDecisionKey) {
    return summaryFromDecisionKey
  }

  const summaryFromSummaryKey = inferSummaryFromStableSummaryKey(entry.summaryKey)
  if (summaryFromSummaryKey) {
    return summaryFromSummaryKey
  }

  const summaryFromMatchHint = inferSummaryFromStableMatchHints(entry.matchHints)
  if (summaryFromMatchHint) {
    return summaryFromMatchHint
  }

  if (hasMultipleStableMatchHints(entry.matchHints)) {
    throw new AnswerInterpretationError(
      `Remaining answerSource "${entry.key}" requires summary, stable prompt, decisionKey, summaryKey, exactly one stable match hint, or stable answerSourceKey for ${label}.`,
    )
  }

  const summaryFromAnswerSourceKey = inferSummaryFromStableAnswerSourceEntryKey(entry)
  if (summaryFromAnswerSourceKey) {
    return summaryFromAnswerSourceKey
  }

  throw new AnswerInterpretationError(
    `Remaining answerSource "${entry.key}" requires summary, stable prompt, decisionKey, summaryKey, exactly one stable match hint, or stable answerSourceKey for ${label}.`,
  )
}

function materializeMatchingOpenDecisionAnswers(
  openDecisions: InterpretableOpenDecision[],
  explicitDecisionKeys: Set<string>,
  sourceResponse: string | undefined,
  answerSources: InterpretableAnswerSource[] | undefined,
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (
    sourceResponseFormat !== 'labeled_sections' &&
    sourceResponseFormat !== 'single_pending' &&
    sourceResponseFormat !== 'pending_clauses' &&
    sourceResponseFormat !== 'pending_paragraphs' &&
    sourceResponseFormat !== 'pending_sentences' &&
    sourceResponseFormat !== 'pending_conjunctions' &&
    sourceResponseFormat !== 'pending_answer_sources' &&
    sourceResponseFormat !== 'matching_answer_sources' &&
    sourceResponseFormat !== 'matching_runs' &&
    sourceResponseFormat !== 'matching_opening_runs' &&
    sourceResponseFormat !== 'matching_closing_runs' &&
    sourceResponseFormat !== 'matching_middle_runs' &&
    sourceResponseFormat !== 'ordered_items' &&
    sourceResponseFormat !== 'ordered_blocks' &&
    sourceResponseFormat !== 'question_blocks' &&
    sourceResponseFormat !== 'question_clauses' &&
    sourceResponseFormat !== 'question_spans' &&
    sourceResponseFormat !== 'question_middle_spans' &&
    sourceResponseFormat !== 'question_closing_spans' &&
    sourceResponseFormat !== 'question_closing_blocks' &&
    sourceResponseFormat !== 'question_middle_blocks' &&
    sourceResponseFormat !== 'inline_topics' &&
    sourceResponseFormat !== 'topic_clauses' &&
    sourceResponseFormat !== 'topic_sentences' &&
    sourceResponseFormat !== 'topic_spans' &&
    sourceResponseFormat !== 'topic_middle_spans' &&
    sourceResponseFormat !== 'topic_closing_spans' &&
    sourceResponseFormat !== 'topic_closing_blocks' &&
    sourceResponseFormat !== 'topic_paragraphs' &&
    sourceResponseFormat !== 'topic_middle_blocks' &&
    sourceResponseFormat !== 'topic_blocks'
  ) {
    throw new AnswerInterpretationError(
      'inferOpenDecisions requires sourceResponseFormat "labeled_sections", "single_pending", "pending_clauses", "pending_paragraphs", "pending_sentences", "pending_conjunctions", "pending_answer_sources", "matching_answer_sources", "matching_runs", "matching_opening_runs", "matching_closing_runs", "matching_middle_runs", "ordered_items", "ordered_blocks", "question_blocks", "question_clauses", "question_spans", "question_middle_spans", "question_closing_spans", "question_closing_blocks", "question_middle_blocks", "inline_topics", "topic_clauses", "topic_sentences", "topic_spans", "topic_middle_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", "topic_middle_blocks", or "topic_blocks".',
    )
  }
  const resolvedAnswerSources = createResolvedAnswerSources(answerSources, sourceResponse)
  const pendingAnswerSourceEntries = resolvedAnswerSources?.entries
  const matchingAnswerSourceEntries = resolvedAnswerSources?.entries
  registerMatchingRunCandidateGroups(
    sourceResponseState,
    openDecisions.map((decision) => buildOpenDecisionSourceResponseCandidates(decision)),
  )

  const sectionsByLabel =
    sourceResponseFormat === 'labeled_sections'
      ? parseRequiredLabeledSourceResponseSections(
          sourceResponse,
          'inferOpenDecisions',
          sourceResponseState,
        )
      : sourceResponseFormat === 'inline_topics'
        ? parseRequiredInlineTopicSections(
            sourceResponse,
            'inferOpenDecisions',
            sourceResponseState,
          )
        : undefined
  const materializedAnswers: Array<{
    summary: string
    decisionKey: string
    taskRef?: string
    answer: string
  }> = []

  for (const decision of openDecisions) {
    if (explicitDecisionKeys.has(decision.decisionKey)) {
      continue
    }
    let match: string | undefined
    if (sourceResponseFormat === 'labeled_sections' || sourceResponseFormat === 'inline_topics') {
      const matchSection = findLabeledSourceResponseSectionEntry(
        sectionsByLabel ?? new Map<string, LabeledSourceResponseSection>(),
        buildOpenDecisionSourceResponseCandidates(decision),
        sourceResponseFormat === 'labeled_sections'
          ? sourceResponseState?.consumedLabeledSectionLabels
          : sourceResponseState?.consumedInlineTopicLabels,
      )
      if (matchSection) {
        assertLabeledValueAuthorityMatchesLabel(
          matchSection.label,
          matchSection.value,
          sourceResponseFormat === 'labeled_sections' ? 'Labeled section' : 'Inline topic clause',
          sourceResponseFormat === 'labeled_sections' ? 'value text' : 'answer text',
        )
        match = matchSection.value
      }
    } else if (sourceResponseFormat === 'single_pending') {
      match = consumeSinglePendingSourceResponse(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Single pending reply for decision answer ${decision.decisionKey}`,
        'sourceResponse',
      )
    } else if (sourceResponseFormat === 'pending_clauses') {
      match = resolvePendingSourceResponseClause(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Pending clause for decision answer ${decision.decisionKey}`,
        'sourceResponse',
      )
    } else if (sourceResponseFormat === 'pending_paragraphs') {
      match = resolvePendingSourceResponseParagraph(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Pending paragraph for decision answer ${decision.decisionKey}`,
        'sourceResponse',
      )
    } else if (sourceResponseFormat === 'pending_sentences') {
      match = resolvePendingSourceResponseSentence(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Pending sentence for decision answer ${decision.decisionKey}`,
        'sourceResponse',
      )
    } else if (sourceResponseFormat === 'pending_conjunctions') {
      match = resolvePendingSourceResponseConjunction(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Pending conjunction for decision answer ${decision.decisionKey}`,
        'sourceResponse',
      )
    } else if (sourceResponseFormat === 'pending_answer_sources') {
      match = resolvePendingAnswerSourceValue(
        pendingAnswerSourceEntries,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        buildDecisionPendingAnswerSourceConsumerDescriptor(decision),
      )
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Pending answerSource for decision answer ${decision.decisionKey}`,
        'answerSource',
      )
    } else if (sourceResponseFormat === 'matching_answer_sources') {
      match = resolveMatchingAnswerSourceValue(
        matchingAnswerSourceEntries,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        'decision',
      )
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Matching answerSource for decision answer ${decision.decisionKey}`,
        'answerSource',
      )
    } else if (sourceResponseFormat === 'matching_runs') {
      match = resolveMatchingRunSourceResponseValue(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
    } else if (sourceResponseFormat === 'matching_opening_runs') {
      match = resolveMatchingOpeningRunSourceResponseValue(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
    } else if (sourceResponseFormat === 'matching_closing_runs') {
      match = resolveMatchingClosingRunSourceResponseValue(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
    } else if (sourceResponseFormat === 'matching_middle_runs') {
      match = resolveMatchingMiddleRunSourceResponseValue(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
    } else if (sourceResponseFormat === 'ordered_blocks') {
      match = resolveOrderedSourceResponseBlock(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Ordered block for decision answer ${decision.decisionKey}`,
        'sourceResponse',
      )
    } else if (sourceResponseFormat === 'question_blocks') {
      match = consumeQuestionBlockSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'question_clauses') {
      match = consumeQuestionClauseSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'question_spans') {
      match = consumeQuestionSpanSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'question_middle_spans') {
      match = consumeQuestionMiddleSpanSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'question_closing_spans') {
      match = consumeQuestionClosingSpanSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'question_closing_blocks') {
      match = consumeQuestionClosingBlockSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'question_middle_blocks') {
      match = consumeQuestionMiddleBlockSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'topic_clauses') {
      match = consumeTopicClauseSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
        true,
      )
    } else if (sourceResponseFormat === 'topic_sentences') {
      match = consumeTopicSentenceSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
        true,
      )
    } else if (sourceResponseFormat === 'topic_spans') {
      match = consumeTopicSpanSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'topic_middle_spans') {
      match = consumeTopicMiddleSpanSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'topic_closing_spans') {
      match = consumeTopicClosingSpanSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'topic_closing_blocks') {
      match = consumeTopicClosingBlockSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'topic_paragraphs') {
      match = consumeTopicParagraphSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
        true,
      )
    } else if (sourceResponseFormat === 'topic_middle_blocks') {
      match = consumeTopicMiddleBlockSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else if (sourceResponseFormat === 'topic_blocks') {
      match = consumeTopicBlockSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
      )
    } else {
      match = resolveOrderedSourceResponseItem(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Ordered item for decision answer ${decision.decisionKey}`,
        'sourceResponse',
      )
    }
    if (!match) {
      continue
    }
    if (sourceResponseFormat === 'matching_runs') {
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Matching run for decision answer ${decision.decisionKey}`,
      )
    } else if (sourceResponseFormat === 'matching_opening_runs') {
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Matching opening run for decision answer ${decision.decisionKey}`,
      )
    } else if (sourceResponseFormat === 'matching_closing_runs') {
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Matching closing run for decision answer ${decision.decisionKey}`,
      )
    } else if (sourceResponseFormat === 'matching_middle_runs') {
      assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        buildOpenDecisionSourceResponseCandidates(decision),
        `Matching middle run for decision answer ${decision.decisionKey}`,
      )
    }
    materializedAnswers.push({
      summary: decision.summary,
      ...(decision.summaryKey?.trim() ? { summaryKey: decision.summaryKey.trim() } : {}),
      decisionKey: decision.decisionKey,
      taskRef: decision.taskRef,
      answer: match,
    })
  }

  return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
}

function materializeNewDecisionTopicAnswers(
  explicitAnswers: InterpretableDecisionAnswerEntryInput[],
  openDecisions: InterpretableOpenDecision[],
  inferOpenDecisions: boolean,
  inferDecisionTopics: boolean,
  sourceResponse: string | undefined,
  answerSources: InterpretableAnswerSource[] | undefined,
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  knownDecisions: InterpretableKnownDecision[],
  reservedAnswerCandidateGroups: string[][],
) {
  if (!inferDecisionTopics) {
    return []
  }

  if (
    sourceResponseFormat !== 'pending_answer_sources' &&
    sourceResponseFormat !== 'matching_answer_sources' &&
    sourceResponseFormat !== 'labeled_sections' &&
    sourceResponseFormat !== 'inline_topics' &&
    sourceResponseFormat !== 'question_clauses' &&
    sourceResponseFormat !== 'topic_clauses' &&
    sourceResponseFormat !== 'question_blocks' &&
    sourceResponseFormat !== 'question_spans' &&
    sourceResponseFormat !== 'question_middle_spans' &&
    sourceResponseFormat !== 'question_closing_spans' &&
    sourceResponseFormat !== 'question_closing_blocks' &&
    sourceResponseFormat !== 'question_middle_blocks' &&
    sourceResponseFormat !== 'topic_sentences' &&
    sourceResponseFormat !== 'topic_spans' &&
    sourceResponseFormat !== 'topic_middle_spans' &&
    sourceResponseFormat !== 'topic_closing_spans' &&
    sourceResponseFormat !== 'topic_closing_blocks' &&
    sourceResponseFormat !== 'topic_paragraphs' &&
    sourceResponseFormat !== 'topic_middle_blocks' &&
    sourceResponseFormat !== 'topic_blocks'
  ) {
    throw new AnswerInterpretationError(
      'inferDecisionTopics requires sourceResponseFormat "pending_answer_sources", "matching_answer_sources", "labeled_sections", "inline_topics", "topic_clauses", "question_blocks", "question_clauses", "question_spans", "question_middle_spans", "question_closing_spans", "question_closing_blocks", "question_middle_blocks", "topic_sentences", "topic_spans", "topic_middle_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", "topic_middle_blocks", or "topic_blocks".',
    )
  }

  const resolvedAnswerSources = createResolvedAnswerSources(answerSources, sourceResponse)
  const pendingAnswerSourceEntries =
    sourceResponseFormat === 'pending_answer_sources' ? resolvedAnswerSources?.entries : undefined
  const matchingAnswerSourceEntries =
    sourceResponseFormat === 'matching_answer_sources' ? resolvedAnswerSources?.entries : undefined

  if (sourceResponseFormat === 'pending_answer_sources') {
    const entries = parseRequiredPendingAnswerSourceEntries(
      pendingAnswerSourceEntries,
      'inferDecisionTopics',
      sourceResponseState,
    )
    const groupedEntries = groupRemainingAnswerSourceEntries(
      entries.slice(sourceResponseState?.nextPendingAnswerSourceIndex ?? 0),
      new Set<number>(),
      'inferDecisionTopics',
      'pending',
      resolveRemainingMatchingDecisionAnswerSourceGroupDescriptor,
    )
    if (sourceResponseState) {
      sourceResponseState.nextPendingAnswerSourceIndex = entries.length
    }
    return materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
      groupedEntries.map((groupedEntry) => groupedEntry.entry),
      knownDecisions,
      'inferDecisionTopics',
    )
  }

  if (sourceResponseFormat === 'matching_answer_sources') {
    const entries = parseRequiredMatchingAnswerSourceEntries(
      matchingAnswerSourceEntries,
      'inferDecisionTopics',
      sourceResponseState,
    )
    const consumedIndexes = sourceResponseState?.consumedMatchingAnswerSourceIndexes ?? new Set()
    const groupedEntries = groupRemainingAnswerSourceEntries(
      entries,
      consumedIndexes,
      'inferDecisionTopics',
      'matching',
      resolveRemainingMatchingDecisionAnswerSourceGroupDescriptor,
    )
    if (sourceResponseState) {
      for (const groupedEntry of groupedEntries) {
        for (const index of groupedEntry.indexes) {
          sourceResponseState.consumedMatchingAnswerSourceIndexes.add(index)
        }
      }
    }
    return materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
      groupedEntries.map((groupedEntry) => groupedEntry.entry),
      knownDecisions,
      'inferDecisionTopics',
    )
  }

  const sectionsByLabel =
    sourceResponseFormat === 'labeled_sections'
      ? parseRequiredLabeledSourceResponseSections(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : sourceResponseFormat === 'inline_topics'
        ? parseRequiredInlineTopicSections(
            sourceResponse,
            'inferDecisionTopics',
            sourceResponseState,
          )
        : new Map<string, LabeledSourceResponseSection>()
  const topicClauses =
    sourceResponseFormat === 'topic_clauses'
      ? parseRequiredTopicSourceResponseClauses(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const questionBlocks =
    sourceResponseFormat === 'question_blocks'
      ? parseRequiredQuestionSourceResponseBlocks(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const questionClauses =
    sourceResponseFormat === 'question_clauses'
      ? parseRequiredQuestionSourceResponseClauses(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const questionSpans =
    sourceResponseFormat === 'question_spans'
      ? parseRequiredQuestionSourceResponseSpans(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const questionMiddleSpans =
    sourceResponseFormat === 'question_middle_spans'
      ? parseRequiredQuestionSourceResponseMiddleSpans(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const questionClosingSpans =
    sourceResponseFormat === 'question_closing_spans'
      ? parseRequiredQuestionSourceResponseClosingSpans(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const questionClosingBlocks =
    sourceResponseFormat === 'question_closing_blocks'
      ? parseRequiredQuestionSourceResponseClosingBlocks(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const questionMiddleBlocks =
    sourceResponseFormat === 'question_middle_blocks'
      ? parseRequiredQuestionSourceResponseMiddleBlocks(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const topicSentences =
    sourceResponseFormat === 'topic_sentences'
      ? parseRequiredTopicSourceResponseSentences(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const topicSpans =
    sourceResponseFormat === 'topic_spans'
      ? parseRequiredTopicSourceResponseSpans(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const topicMiddleSpans =
    sourceResponseFormat === 'topic_middle_spans'
      ? parseRequiredTopicSourceResponseMiddleSpans(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const topicClosingSpans =
    sourceResponseFormat === 'topic_closing_spans'
      ? parseRequiredTopicSourceResponseClosingSpans(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const topicClosingBlocks =
    sourceResponseFormat === 'topic_closing_blocks'
      ? parseRequiredTopicSourceResponseClosingBlocks(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const topicParagraphs =
    sourceResponseFormat === 'topic_paragraphs'
      ? parseRequiredTopicSourceResponseParagraphs(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const topicMiddleBlocks =
    sourceResponseFormat === 'topic_middle_blocks'
      ? parseRequiredTopicSourceResponseMiddleBlocks(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const topicBlocks =
    sourceResponseFormat === 'topic_blocks'
      ? parseRequiredTopicSourceResponseBlocks(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const reservedLabels = new Set<string>()
  const consumedLabels =
    sourceResponseFormat === 'labeled_sections'
      ? sourceResponseState?.consumedLabeledSectionLabels
      : sourceResponseFormat === 'inline_topics'
        ? sourceResponseState?.consumedInlineTopicLabels
        : undefined
  const reservedQuestionBlockIndexes = new Set<number>()
  const reservedQuestionClauseIndexes = new Set<number>()
  const reservedQuestionSpanIndexes = new Set<number>()
  const reservedQuestionMiddleSpanIndexes = new Set<number>()
  const reservedQuestionClosingSpanIndexes = new Set<number>()
  const reservedQuestionClosingBlockIndexes = new Set<number>()
  const reservedQuestionMiddleBlockIndexes = new Set<number>()
  const reservedTopicClauseIndexes = new Set<number>()
  const reservedTopicSentenceIndexes = new Set<number>()
  const reservedTopicSpanIndexes = new Set<number>()
  const reservedTopicMiddleSpanIndexes = new Set<number>()
  const reservedTopicClosingSpanIndexes = new Set<number>()
  const reservedTopicClosingBlockIndexes = new Set<number>()
  const reservedTopicParagraphIndexes = new Set<number>()
  const reservedTopicMiddleBlockIndexes = new Set<number>()
  const reservedTopicBlockIndexes = new Set<number>()

  for (const answer of explicitAnswers) {
    if (questionBlocks) {
      reserveMatchedQuestionBlock(
        questionBlocks,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedQuestionBlockIndexes,
      )
      continue
    }

    if (questionClauses) {
      reserveMatchedQuestionSpan(
        questionClauses,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedQuestionClauseIndexes,
      )
      continue
    }

    if (questionSpans) {
      reserveMatchedQuestionSpan(
        questionSpans,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedQuestionSpanIndexes,
      )
      continue
    }

    if (questionMiddleSpans) {
      reserveMatchedQuestionSpan(
        questionMiddleSpans,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedQuestionMiddleSpanIndexes,
      )
      continue
    }

    if (questionClosingSpans) {
      reserveMatchedQuestionClosingSpan(
        questionClosingSpans,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedQuestionClosingSpanIndexes,
      )
      continue
    }

    if (questionClosingBlocks) {
      reserveMatchedQuestionClosingBlock(
        questionClosingBlocks,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedQuestionClosingBlockIndexes,
      )
      continue
    }

    if (questionMiddleBlocks) {
      reserveMatchedQuestionBlock(
        questionMiddleBlocks,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedQuestionMiddleBlockIndexes,
      )
      continue
    }

    if (topicClauses) {
      reserveMatchedTopicClause(
        topicClauses,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedTopicClauseIndexes,
      )
      continue
    }

    if (topicSentences) {
      reserveMatchedTopicSentence(
        topicSentences,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedTopicSentenceIndexes,
      )
      continue
    }

    if (topicSpans) {
      reserveMatchedTopicSpan(
        topicSpans,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedTopicSpanIndexes,
      )
      continue
    }

    if (topicMiddleSpans) {
      reserveMatchedTopicSpan(
        topicMiddleSpans,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedTopicMiddleSpanIndexes,
      )
      continue
    }

    if (topicClosingSpans) {
      reserveMatchedTopicClosingSpan(
        topicClosingSpans,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedTopicClosingSpanIndexes,
      )
      continue
    }

    if (topicClosingBlocks) {
      reserveMatchedTopicClosingBlock(
        topicClosingBlocks,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedTopicClosingBlockIndexes,
      )
      continue
    }

    if (topicParagraphs) {
      reserveMatchedTopicParagraph(
        topicParagraphs,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedTopicParagraphIndexes,
      )
      continue
    }

    if (topicMiddleBlocks) {
      reserveMatchedTopicBlock(
        topicMiddleBlocks,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedTopicMiddleBlockIndexes,
      )
      continue
    }

    if (topicBlocks) {
      reserveMatchedTopicBlock(
        topicBlocks,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedTopicBlockIndexes,
      )
      continue
    }

    reserveMatchedLabeledSection(
      sectionsByLabel,
      buildDecisionAnswerSourceResponseCandidates(answer),
      reservedLabels,
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
      if (questionBlocks) {
        reserveMatchedQuestionBlock(
          questionBlocks,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedQuestionBlockIndexes,
        )
        continue
      }

      if (questionClauses) {
        reserveMatchedQuestionSpan(
          questionClauses,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedQuestionClauseIndexes,
        )
        continue
      }

      if (questionSpans) {
        reserveMatchedQuestionSpan(
          questionSpans,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedQuestionSpanIndexes,
        )
        continue
      }

      if (questionMiddleSpans) {
        reserveMatchedQuestionSpan(
          questionMiddleSpans,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedQuestionMiddleSpanIndexes,
        )
        continue
      }

      if (questionClosingSpans) {
        reserveMatchedQuestionClosingSpan(
          questionClosingSpans,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedQuestionClosingSpanIndexes,
        )
        continue
      }

      if (questionClosingBlocks) {
        reserveMatchedQuestionClosingBlock(
          questionClosingBlocks,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedQuestionClosingBlockIndexes,
        )
        continue
      }

      if (questionMiddleBlocks) {
        reserveMatchedQuestionBlock(
          questionMiddleBlocks,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedQuestionMiddleBlockIndexes,
        )
        continue
      }

      if (topicClauses) {
        reserveMatchedTopicClause(
          topicClauses,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedTopicClauseIndexes,
        )
        continue
      }

      if (topicSentences) {
        reserveMatchedTopicSentence(
          topicSentences,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedTopicSentenceIndexes,
        )
        continue
      }

      if (topicSpans) {
        reserveMatchedTopicSpan(
          topicSpans,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedTopicSpanIndexes,
        )
        continue
      }

      if (topicMiddleSpans) {
        reserveMatchedTopicSpan(
          topicMiddleSpans,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedTopicMiddleSpanIndexes,
        )
        continue
      }

      if (topicClosingSpans) {
        reserveMatchedTopicClosingSpan(
          topicClosingSpans,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedTopicClosingSpanIndexes,
        )
        continue
      }

      if (topicClosingBlocks) {
        reserveMatchedTopicClosingBlock(
          topicClosingBlocks,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedTopicClosingBlockIndexes,
        )
        continue
      }

      if (topicParagraphs) {
        reserveMatchedTopicParagraph(
          topicParagraphs,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedTopicParagraphIndexes,
        )
        continue
      }

      if (topicMiddleBlocks) {
        reserveMatchedTopicBlock(
          topicMiddleBlocks,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedTopicMiddleBlockIndexes,
        )
        continue
      }

      if (topicBlocks) {
        reserveMatchedTopicBlock(
          topicBlocks,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedTopicBlockIndexes,
        )
        continue
      }

      reserveMatchedLabeledSection(
        sectionsByLabel,
        buildOpenDecisionSourceResponseCandidates(decision),
        reservedLabels,
      )
    }
  }

  for (const candidates of reservedAnswerCandidateGroups) {
    if (questionBlocks) {
      reserveMatchedQuestionBlock(questionBlocks, candidates, reservedQuestionBlockIndexes)
      continue
    }

    if (questionClauses) {
      reserveMatchedQuestionSpan(questionClauses, candidates, reservedQuestionClauseIndexes)
      continue
    }

    if (questionSpans) {
      reserveMatchedQuestionSpan(questionSpans, candidates, reservedQuestionSpanIndexes)
      continue
    }

    if (questionMiddleSpans) {
      reserveMatchedQuestionSpan(questionMiddleSpans, candidates, reservedQuestionMiddleSpanIndexes)
      continue
    }

    if (questionClosingSpans) {
      reserveMatchedQuestionClosingSpan(
        questionClosingSpans,
        candidates,
        reservedQuestionClosingSpanIndexes,
      )
      continue
    }

    if (questionClosingBlocks) {
      reserveMatchedQuestionClosingBlock(
        questionClosingBlocks,
        candidates,
        reservedQuestionClosingBlockIndexes,
      )
      continue
    }

    if (questionMiddleBlocks) {
      reserveMatchedQuestionBlock(
        questionMiddleBlocks,
        candidates,
        reservedQuestionMiddleBlockIndexes,
      )
      continue
    }

    if (topicClauses) {
      reserveMatchedTopicClause(topicClauses, candidates, reservedTopicClauseIndexes)
      continue
    }

    if (topicSentences) {
      reserveMatchedTopicSentence(topicSentences, candidates, reservedTopicSentenceIndexes)
      continue
    }

    if (topicSpans) {
      reserveMatchedTopicSpan(topicSpans, candidates, reservedTopicSpanIndexes)
      continue
    }

    if (topicMiddleSpans) {
      reserveMatchedTopicSpan(topicMiddleSpans, candidates, reservedTopicMiddleSpanIndexes)
      continue
    }

    if (topicClosingSpans) {
      reserveMatchedTopicClosingSpan(topicClosingSpans, candidates, reservedTopicClosingSpanIndexes)
      continue
    }

    if (topicClosingBlocks) {
      reserveMatchedTopicClosingBlock(
        topicClosingBlocks,
        candidates,
        reservedTopicClosingBlockIndexes,
      )
      continue
    }

    if (topicParagraphs) {
      reserveMatchedTopicParagraph(topicParagraphs, candidates, reservedTopicParagraphIndexes)
      continue
    }

    if (topicMiddleBlocks) {
      reserveMatchedTopicBlock(topicMiddleBlocks, candidates, reservedTopicMiddleBlockIndexes)
      continue
    }

    if (topicBlocks) {
      reserveMatchedTopicBlock(topicBlocks, candidates, reservedTopicBlockIndexes)
      continue
    }

    reserveMatchedLabeledSection(sectionsByLabel, candidates, reservedLabels)
  }

  const materializedAnswers: MaterializedInterpretedDecisionAnswer[] = []

  if (questionBlocks) {
    for (const [index, block] of questionBlocks.entries()) {
      if (reservedQuestionBlockIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForQuestionBlock(
        block,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred question block "${block.question}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferSummaryFromQuestionLabel(block.question),
        prompt: matchingKnownDecision?.prompt ?? block.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.answer,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (questionClauses) {
    for (const [index, clause] of questionClauses.entries()) {
      if (reservedQuestionClauseIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForQuestionSpan(
        clause,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred question clause "${clause.question}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferSummaryFromQuestionLabel(clause.question),
        prompt: matchingKnownDecision?.prompt ?? clause.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: clause.answer,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (questionSpans) {
    for (const [index, span] of questionSpans.entries()) {
      if (reservedQuestionSpanIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForQuestionSpan(span, knownDecisions)
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred question span "${span.question}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferSummaryFromQuestionLabel(span.question),
        prompt: matchingKnownDecision?.prompt ?? span.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.answer,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (questionMiddleSpans) {
    for (const [index, span] of questionMiddleSpans.entries()) {
      if (reservedQuestionMiddleSpanIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForQuestionSpan(span, knownDecisions)
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred question middle span "${span.question}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferSummaryFromQuestionLabel(span.question),
        prompt: matchingKnownDecision?.prompt ?? span.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.answer,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (questionClosingSpans) {
    for (const [index, span] of questionClosingSpans.entries()) {
      if (reservedQuestionClosingSpanIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForQuestionClosingSpan(
        span,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred question closing span "${span.question}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferSummaryFromQuestionLabel(span.question),
        prompt: matchingKnownDecision?.prompt ?? span.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.answer,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (questionClosingBlocks) {
    for (const [index, block] of questionClosingBlocks.entries()) {
      if (reservedQuestionClosingBlockIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForQuestionClosingBlock(
        block,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred question closing block "${block.question}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferSummaryFromQuestionLabel(block.question),
        prompt: matchingKnownDecision?.prompt ?? block.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.answer,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (questionMiddleBlocks) {
    for (const [index, block] of questionMiddleBlocks.entries()) {
      if (reservedQuestionMiddleBlockIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForQuestionBlock(
        block,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred question middle block "${block.question}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferSummaryFromQuestionLabel(block.question),
        prompt: matchingKnownDecision?.prompt ?? block.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.answer,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (topicClauses) {
    for (const [index, clause] of topicClauses.entries()) {
      if (reservedTopicClauseIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForTopicClause(
        clause,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred topic clause "${clause.text}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      assertTopicAnswerTextDoesNotContainQuestionAuthority(clause.text, 'Topic clause')
      const summary =
        matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicSentence(clause.text)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: clause.text,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (topicSentences) {
    for (const [index, sentence] of topicSentences.entries()) {
      if (reservedTopicSentenceIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForTopicSentence(
        sentence,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred topic sentence "${sentence.text}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      assertTopicAnswerTextDoesNotContainQuestionAuthority(sentence.text, 'Topic sentence')
      const summary =
        matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicSentence(sentence.text)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: sentence.text,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (topicSpans) {
    for (const [index, span] of topicSpans.entries()) {
      if (reservedTopicSpanIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForTopicSpan(span, knownDecisions)
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred topic span "${span.anchorText}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      assertTopicAnswerTextDoesNotContainQuestionAuthority(span.text, 'Topic span')
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicSpan(span)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.text,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (topicMiddleSpans) {
    for (const [index, span] of topicMiddleSpans.entries()) {
      if (reservedTopicMiddleSpanIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForTopicSpan(span, knownDecisions)
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred topic middle span "${span.anchorText}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      assertTopicAnswerTextDoesNotContainQuestionAuthority(span.text, 'Topic middle span')
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicSpan(span)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.text,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (topicClosingSpans) {
    for (const [index, span] of topicClosingSpans.entries()) {
      if (reservedTopicClosingSpanIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForTopicClosingSpan(
        span,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred topic closing span "${span.closingText}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      assertTopicAnswerTextDoesNotContainQuestionAuthority(span.text, 'Topic closing span')
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicClosingSpan(span)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.text,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (topicClosingBlocks) {
    for (const [index, block] of topicClosingBlocks.entries()) {
      if (reservedTopicClosingBlockIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForTopicClosingBlock(
        block,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred topic closing block "${block.closingText}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      assertTopicAnswerTextDoesNotContainQuestionAuthority(block.text, 'Topic closing block')
      const summary =
        matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicClosingBlock(block)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.text,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (topicParagraphs) {
    for (const [index, paragraph] of topicParagraphs.entries()) {
      if (reservedTopicParagraphIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForTopicParagraph(
        paragraph,
        knownDecisions,
      )
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred topic paragraph "${paragraph.text}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      assertTopicAnswerTextDoesNotContainQuestionAuthority(paragraph.text, 'Topic paragraph')
      const summary =
        matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicParagraph(paragraph.text)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: paragraph.text,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (topicMiddleBlocks) {
    for (const [index, block] of topicMiddleBlocks.entries()) {
      if (reservedTopicMiddleBlockIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForTopicBlock(block, knownDecisions)
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred topic middle block "${block.anchorText}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      assertTopicAnswerTextDoesNotContainQuestionAuthority(block.text, 'Topic middle block')
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicBlock(block)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.text,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  if (topicBlocks) {
    for (const [index, block] of topicBlocks.entries()) {
      if (reservedTopicBlockIndexes.has(index)) {
        continue
      }

      const matchingKnownDecisions = findMatchingKnownDecisionsForTopicBlock(block, knownDecisions)
      if (matchingKnownDecisions.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple existing decisions match inferred topic block "${block.anchorText}".`,
        )
      }

      const matchingKnownDecision = matchingKnownDecisions[0]
      assertTopicAnswerTextDoesNotContainQuestionAuthority(block.text, 'Topic block')
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicBlock(block)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.text,
      })
    }

    return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
  }

  const knownDecisionsBySummary = createKnownDecisionsBySummaryLookup(knownDecisions)
  const labeledSectionUnitLabel =
    sourceResponseFormat === 'inline_topics' ? 'Inline topic clause' : 'Labeled section'
  const labeledSectionValueLabel =
    sourceResponseFormat === 'inline_topics' ? 'answer text' : 'value text'
  for (const [normalizedLabel, section] of sectionsByLabel) {
    if (reservedLabels.has(normalizedLabel)) {
      continue
    }

    assertLabeledValueAuthorityMatchesLabel(
      section.label,
      section.value,
      labeledSectionUnitLabel,
      labeledSectionValueLabel,
    )
    consumedLabels?.add(normalizedLabel)
    const matchingKnownDecisions = knownDecisionsBySummary.get(normalizedLabel) ?? []
    if (matchingKnownDecisions.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple existing decisions match inferred label "${section.label}".`,
      )
    }

    const matchingKnownDecision = matchingKnownDecisions[0]
    const summary = matchingKnownDecision?.summary ?? section.label
    materializedAnswers.push({
      summary,
      ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
      decisionKey: matchingKnownDecision?.decisionKey,
      taskRef: matchingKnownDecision?.taskRef,
      answer: section.value,
    })
  }

  return finalizeMaterializedDecisionAnswers(materializedAnswers, sourceResponseFormat)
}

function parseRequiredLabeledSourceResponseSections(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.labeledSections) {
    return sourceResponseState.labeledSections
  }
  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat labeled_sections requires sourceResponse for ${label}.`,
    )
  }

  const sections = parseLabeledSourceResponseSections(shared)
  if (sourceResponseState) {
    sourceResponseState.labeledSections = sections
  }
  return sections
}

function parseRequiredInlineTopicSections(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.inlineTopics) {
    return sourceResponseState.inlineTopics
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat inline_topics requires sourceResponse for ${label}.`,
    )
  }

  const sections = parseInlineTopicSections(shared)
  if (sourceResponseState) {
    sourceResponseState.inlineTopics = sections
  }
  return sections
}

function parseRequiredQuestionSourceResponseBlocks(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.questionBlocks) {
    return sourceResponseState.questionBlocks
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat question_blocks requires sourceResponse for ${label}.`,
    )
  }

  const blocks = parseQuestionSourceResponseBlocks(shared)
  if (sourceResponseState) {
    sourceResponseState.questionBlocks = blocks
  }
  return blocks
}

function parseRequiredQuestionSourceResponseClauses(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.questionClauses) {
    return sourceResponseState.questionClauses
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat question_clauses requires sourceResponse for ${label}.`,
    )
  }

  const clauses = parseQuestionSourceResponseClauses(shared)
  if (sourceResponseState) {
    sourceResponseState.questionClauses = clauses
  }
  return clauses
}

function parseRequiredQuestionSourceResponseSpans(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.questionSpans) {
    return sourceResponseState.questionSpans
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat question_spans requires sourceResponse for ${label}.`,
    )
  }

  const sentences = parseGenericMatchingSourceResponseSentenceUnits(shared)
  if (sentences.length === 1) {
    const embeddedSpans = parseEmbeddedQuestionSourceResponseSpans(
      shared,
      sourceResponseState?.questionAnchorCandidateGroups ?? [],
    )
    if (embeddedSpans) {
      if (sourceResponseState) {
        sourceResponseState.questionSpans = embeddedSpans
      }
      return embeddedSpans
    }
  }

  const spans = parseQuestionSourceResponseSpans(shared)
  if (sourceResponseState) {
    sourceResponseState.questionSpans = spans
  }
  return spans
}

function parseEmbeddedQuestionSourceResponseSpans(
  sourceResponse: string,
  candidateGroups: string[][],
) {
  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
  if (tokens.length === 0) {
    return undefined
  }

  const anchors = resolveEmbeddedQuestionAnchorsWithInferredCandidates(
    sourceResponse,
    tokens,
    candidateGroups,
    'question_spans',
  )
  if (anchors.length === 0) {
    return undefined
  }

  if (anchors[0]?.startTokenIndex !== 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_spans requires sourceResponse to start with a matched question anchor.',
    )
  }

  const spans: QuestionSourceResponseSpan[] = []
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as EmbeddedMatchingRunAnchor
    const nextAnchor = anchors[index + 1]
    if (nextAnchor) {
      if (nextAnchor.startTokenIndex === anchor.endTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_spans requires each embedded question anchor to include answer text before the next matched question anchor.',
        )
      }
    } else if (anchor.endTokenIndex >= tokens.length) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_spans requires each embedded question anchor to include answer text after the matched question anchor.',
      )
    }

    const question = normalizeEmbeddedQuestionAnchorText(
      sourceResponse.slice(anchor.startOriginal, anchor.endOriginal).trim(),
    )
    const answer = normalizeEmbeddedMatchingRunText(
      sourceResponse.slice(anchor.endOriginal, nextAnchor?.startOriginal ?? sourceResponse.length),
    )
    assertQuestionAnswerTopicAuthorityMatchesQuestion(question, answer, 'Question span')
    spans.push({
      question,
      normalizedQuestionText: normalizeSourceResponseText(question),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(question),
      answer,
    })
  }

  return spans
}

function parseRequiredQuestionSourceResponseMiddleSpans(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.questionMiddleSpans) {
    return sourceResponseState.questionMiddleSpans
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat question_middle_spans requires sourceResponse for ${label}.`,
    )
  }

  const sentences = parseGenericMatchingSourceResponseSentenceUnits(shared)
  if (sentences.length === 1) {
    const embeddedSpans = parseEmbeddedQuestionSourceResponseMiddleSpans(
      shared,
      sourceResponseState?.questionAnchorCandidateGroups ?? [],
    )
    if (embeddedSpans) {
      if (sourceResponseState) {
        sourceResponseState.questionMiddleSpans = embeddedSpans
      }
      return embeddedSpans
    }
  }

  const spans = parseQuestionSourceResponseMiddleSpans(shared)
  if (sourceResponseState) {
    sourceResponseState.questionMiddleSpans = spans
  }
  return spans
}

function parseEmbeddedQuestionSourceResponseMiddleSpans(
  sourceResponse: string,
  candidateGroups: string[][],
) {
  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
  if (tokens.length === 0) {
    return undefined
  }

  const anchors = resolveEmbeddedQuestionAnchorsWithInferredCandidates(
    sourceResponse,
    tokens,
    candidateGroups,
    'question_middle_spans',
  )
  if (anchors.length === 0) {
    return undefined
  }

  if (anchors[0]?.startTokenIndex === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_middle_spans requires each span to start with at least one leading sentence before the question sentence.',
    )
  }

  const spans: QuestionSourceResponseSpan[] = []
  let currentSpanStartOriginal = 0

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as EmbeddedMatchingRunAnchor
    const nextAnchor = anchors[index + 1]
    const trailingTokenCount = tokens.length - anchor.endTokenIndex

    const question = normalizeEmbeddedQuestionAnchorText(
      sourceResponse.slice(anchor.startOriginal, anchor.endOriginal).trim(),
    )
    const leadingAnswer = normalizeEmbeddedMatchingRunText(
      sourceResponse.slice(currentSpanStartOriginal, anchor.startOriginal),
    )

    if (index === anchors.length - 1) {
      if (trailingTokenCount === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_middle_spans requires each span to end with at least one trailing sentence after the question sentence.',
        )
      }

      const trailingAnswer = normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(anchor.endOriginal),
      )
      const answer = [leadingAnswer, trailingAnswer].filter(Boolean).join(' ')
      assertQuestionAnswerTopicAuthorityMatchesQuestion(
        question,
        answer,
        'Question middle span',
      )
      spans.push({
        question,
        normalizedQuestionText: normalizeSourceResponseText(question),
        normalizedQuestionCoreText: normalizeQuestionPromptCore(question),
        answer,
      })
      break
    }

    if (!nextAnchor) {
      break
    }

    const gapTokenCount = nextAnchor.startTokenIndex - anchor.endTokenIndex
    if (gapTokenCount < 2) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_spans requires at least one trailing sentence before the next question sentence and at least one leading sentence for that next span.',
      )
    }

    const nextSpanLeadingTokenStartOriginal =
      tokens[nextAnchor.startTokenIndex - 1]?.start ?? sourceResponse.length
    const trailingAnswer = normalizeEmbeddedMatchingRunText(
      sourceResponse.slice(anchor.endOriginal, nextSpanLeadingTokenStartOriginal),
    )
    const answer = [leadingAnswer, trailingAnswer].filter(Boolean).join(' ')
    assertQuestionAnswerTopicAuthorityMatchesQuestion(question, answer, 'Question middle span')
    spans.push({
      question,
      normalizedQuestionText: normalizeSourceResponseText(question),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(question),
      answer,
    })
    currentSpanStartOriginal = nextSpanLeadingTokenStartOriginal
  }

  return spans
}

function parseRequiredQuestionSourceResponseClosingSpans(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.questionClosingSpans) {
    return sourceResponseState.questionClosingSpans
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat question_closing_spans requires sourceResponse for ${label}.`,
    )
  }

  const sentences = parseGenericMatchingSourceResponseSentenceUnits(shared)
  if (sentences.length === 1) {
    const embeddedSpans = parseEmbeddedQuestionSourceResponseClosingSpans(
      shared,
      sourceResponseState?.questionAnchorCandidateGroups ?? [],
    )
    if (embeddedSpans) {
      if (sourceResponseState) {
        sourceResponseState.questionClosingSpans = embeddedSpans
      }
      return embeddedSpans
    }
  }

  const spans = parseQuestionSourceResponseClosingSpans(shared)
  if (sourceResponseState) {
    sourceResponseState.questionClosingSpans = spans
  }
  return spans
}

function parseEmbeddedQuestionSourceResponseClosingSpans(
  sourceResponse: string,
  candidateGroups: string[][],
) {
  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
  if (tokens.length === 0) {
    return undefined
  }

  const anchors = resolveEmbeddedQuestionAnchorsWithInferredCandidates(
    sourceResponse,
    tokens,
    candidateGroups,
    'question_closing_spans',
  )
  if (anchors.length === 0) {
    return undefined
  }

  if (anchors[0]?.startTokenIndex === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_closing_spans requires each span to include at least one leading sentence before the question sentence.',
    )
  }

  const spans: QuestionSourceResponseClosingSpan[] = []
  let previousEndTokenIndex = 0
  let previousEndOriginal = 0

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as EmbeddedMatchingRunAnchor

    if (index > 0 && anchor.startTokenIndex === previousEndTokenIndex) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_closing_spans requires at least one leading sentence before the next question sentence.',
      )
    }

    const hasTrailingTokens = anchor.endTokenIndex < tokens.length
    if (index === anchors.length - 1 && hasTrailingTokens) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_closing_spans requires each span to end with a question sentence.',
      )
    }

    const question = normalizeEmbeddedQuestionAnchorText(
      sourceResponse.slice(anchor.startOriginal, anchor.endOriginal).trim(),
    )
    const answer = normalizeEmbeddedMatchingRunText(
      sourceResponse.slice(previousEndOriginal, anchor.startOriginal),
    )
    assertQuestionAnswerTopicAuthorityMatchesQuestion(question, answer, 'Question closing span')
    spans.push({
      question,
      normalizedQuestionText: normalizeSourceResponseText(question),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(question),
      answer,
    })
    previousEndTokenIndex = anchor.endTokenIndex
    previousEndOriginal = tokens[anchor.endTokenIndex]?.start ?? sourceResponse.length
  }

  return spans
}

function parseRequiredQuestionSourceResponseClosingBlocks(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.questionClosingBlocks) {
    return sourceResponseState.questionClosingBlocks
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat question_closing_blocks requires sourceResponse for ${label}.`,
    )
  }

  const blocks = parseQuestionSourceResponseClosingBlocks(shared)
  if (sourceResponseState) {
    sourceResponseState.questionClosingBlocks = blocks
  }
  return blocks
}

function parseRequiredQuestionSourceResponseMiddleBlocks(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.questionMiddleBlocks) {
    return sourceResponseState.questionMiddleBlocks
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat question_middle_blocks requires sourceResponse for ${label}.`,
    )
  }

  const blocks = parseQuestionSourceResponseMiddleBlocks(shared)
  if (sourceResponseState) {
    sourceResponseState.questionMiddleBlocks = blocks
  }
  return blocks
}

function parseRequiredTopicSourceResponseClauses(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.topicClauses) {
    return sourceResponseState.topicClauses
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat topic_clauses requires sourceResponse for ${label}.`,
    )
  }

  const clauseCandidates = sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>()
  const sentenceClauses = parseTopicSourceResponseClauses(shared)
  if (sentenceClauses.length === 1) {
    const embeddedClauses = parseEmbeddedTopicSourceResponseClauses(shared, clauseCandidates)
    if (embeddedClauses) {
      if (sourceResponseState) {
        sourceResponseState.topicClauses = embeddedClauses
      }
      return embeddedClauses
    }
  }

  const clauses = sentenceClauses
  if (sourceResponseState) {
    sourceResponseState.topicClauses = clauses
  }
  return clauses
}

function parseRequiredTopicSourceResponseSentences(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.topicSentences) {
    return sourceResponseState.topicSentences
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat topic_sentences requires sourceResponse for ${label}.`,
    )
  }

  const sentences = parseTopicSourceResponseSentences(shared)
  if (sourceResponseState) {
    sourceResponseState.topicSentences = sentences
  }
  return sentences
}

function parseRequiredTopicSourceResponseSpans(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.topicSpans) {
    return sourceResponseState.topicSpans
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat topic_spans requires sourceResponse for ${label}.`,
    )
  }

  const sentences = parseGenericMatchingSourceResponseSentenceUnits(shared)
  if (sentences.length === 1) {
    const embeddedSpans = parseEmbeddedTopicSourceResponseSpans(
      shared,
      sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
    )
    if (embeddedSpans) {
      if (sourceResponseState) {
        sourceResponseState.topicSpans = embeddedSpans
      }
      return embeddedSpans
    }
  }

  const spans = parseTopicSourceResponseSpans(
    sentences,
    sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
  )
  if (sourceResponseState) {
    sourceResponseState.topicSpans = spans
  }
  return spans
}

function parseEmbeddedTopicSourceResponseSpans(
  sourceResponse: string,
  normalizedCandidateLabels: Set<string>,
) {
  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
  if (tokens.length === 0) {
    return undefined
  }

  const candidateLabels = dedupeNonEmptyStrings([
    ...normalizedCandidateLabels,
    ...(normalizedCandidateLabels.size > 1
      ? []
      : inferEmbeddedLeadingTopicCandidateLabels(sourceResponse, tokens)),
  ])
  const anchors = resolveEmbeddedTopicAnchors(
    sourceResponse,
    tokens,
    candidateLabels,
    'topic_spans',
  )
  if (anchors.length === 0) {
    return undefined
  }

  if (anchors[0]?.startTokenIndex !== 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat topic_spans requires sourceResponse to start with a topic anchor sentence.',
    )
  }

  const spans: TopicSourceResponseSpan[] = []
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as EmbeddedTopicAnchor
    const nextAnchor = anchors[index + 1]

    if (nextAnchor) {
      if (nextAnchor.startTokenIndex === anchor.endTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_spans requires each span to include answer text after the topic anchor.',
        )
      }
    } else if (anchor.endTokenIndex >= tokens.length) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_spans requires each span to include answer text after the topic anchor.',
      )
    }

    const endOriginal = nextAnchor?.startOriginal ?? sourceResponse.length
    const text = normalizeEmbeddedMatchingRunText(
      sourceResponse.slice(anchor.startOriginal, endOriginal),
    )
    const matchingLabels = findMatchingNormalizedTopicLabels(
      normalizeSourceResponseText(text),
      normalizedCandidateLabels,
    )
    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple topic span anchors matched sentence "${text}" in sourceResponse.`,
      )
    }

    spans.push({
      text,
      anchorText: text,
      normalizedAnchorLabel: matchingLabels[0] ?? anchor.normalizedLabel,
    })
  }

  return spans
}

function parseRequiredTopicSourceResponseMiddleSpans(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.topicMiddleSpans) {
    return sourceResponseState.topicMiddleSpans
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat topic_middle_spans requires sourceResponse for ${label}.`,
    )
  }

  const sentences = parseGenericMatchingSourceResponseSentenceUnits(shared)
  if (sentences.length === 1) {
    const embeddedSpans = parseEmbeddedTopicSourceResponseMiddleSpans(
      shared,
      sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
    )
    if (embeddedSpans) {
      if (sourceResponseState) {
        sourceResponseState.topicMiddleSpans = embeddedSpans
      }
      return embeddedSpans
    }
  }

  const spans = parseTopicSourceResponseMiddleSpans(
    sentences,
    sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
  )
  if (sourceResponseState) {
    sourceResponseState.topicMiddleSpans = spans
  }
  return spans
}

function parseEmbeddedTopicSourceResponseMiddleSpans(
  sourceResponse: string,
  normalizedCandidateLabels: Set<string>,
) {
  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
  if (tokens.length === 0) {
    return undefined
  }

  const candidateLabels = dedupeNonEmptyStrings([
    ...normalizedCandidateLabels,
    ...(normalizedCandidateLabels.size > 1
      ? []
      : inferEmbeddedLeadingTopicCandidateLabels(sourceResponse, tokens)),
  ])
  const anchors = resolveEmbeddedTopicAnchors(
    sourceResponse,
    tokens,
    candidateLabels,
    'topic_middle_spans',
  )
  if (anchors.length === 0) {
    return undefined
  }

  if (anchors[0]?.startTokenIndex === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat topic_middle_spans requires each span to start with at least one leading sentence before the topic anchor sentence.',
    )
  }

  const spans: TopicSourceResponseSpan[] = []
  let currentSpanStartOriginal = 0

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as EmbeddedTopicAnchor
    const nextAnchor = anchors[index + 1]
    const trailingTokenCount = tokens.length - anchor.endTokenIndex

    if (index === anchors.length - 1) {
      if (trailingTokenCount === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_middle_spans requires each span to end with at least one trailing sentence after the topic anchor sentence.',
        )
      }

      const text = normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(currentSpanStartOriginal),
      )
      const anchorText = normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(anchor.startOriginal),
      )
      const matchingLabels = findMatchingNormalizedTopicLabels(
        normalizeSourceResponseText(text),
        normalizedCandidateLabels,
      )
      if (matchingLabels.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple topic middle span anchors matched sentence "${text}" in sourceResponse.`,
        )
      }

      spans.push({
        text,
        anchorText,
        normalizedAnchorLabel: matchingLabels[0] ?? anchor.normalizedLabel,
      })
      break
    }

    if (!nextAnchor) {
      break
    }

    const gapTokenCount = nextAnchor.startTokenIndex - anchor.endTokenIndex
    if (gapTokenCount < 2) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_middle_spans requires at least one trailing sentence before the next topic anchor sentence and at least one leading sentence for that next span.',
      )
    }

    const nextSpanLeadingTokenStartOriginal =
      tokens[nextAnchor.startTokenIndex - 1]?.start ?? sourceResponse.length
    const text = normalizeEmbeddedMatchingRunText(
      sourceResponse.slice(currentSpanStartOriginal, nextSpanLeadingTokenStartOriginal),
    )
    const anchorText = normalizeEmbeddedMatchingRunText(
      sourceResponse.slice(anchor.startOriginal, nextSpanLeadingTokenStartOriginal),
    )
    const matchingLabels = findMatchingNormalizedTopicLabels(
      normalizeSourceResponseText(text),
      normalizedCandidateLabels,
    )
    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple topic middle span anchors matched sentence "${text}" in sourceResponse.`,
      )
    }

    spans.push({
      text,
      anchorText,
      normalizedAnchorLabel: matchingLabels[0] ?? anchor.normalizedLabel,
    })
    currentSpanStartOriginal = nextSpanLeadingTokenStartOriginal
  }

  return spans
}

function parseRequiredTopicSourceResponseClosingSpans(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.topicClosingSpans) {
    return sourceResponseState.topicClosingSpans
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat topic_closing_spans requires sourceResponse for ${label}.`,
    )
  }

  const sentences = parseGenericMatchingSourceResponseSentenceUnits(shared)
  if (sentences.length === 1) {
    const embeddedSpans = parseEmbeddedTopicSourceResponseClosingSpans(
      shared,
      sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
    )
    if (embeddedSpans) {
      if (sourceResponseState) {
        sourceResponseState.topicClosingSpans = embeddedSpans
      }
      return embeddedSpans
    }
  }

  const spans = parseTopicSourceResponseClosingSpans(
    sentences,
    sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
  )
  if (sourceResponseState) {
    sourceResponseState.topicClosingSpans = spans
  }
  return spans
}

function parseEmbeddedTopicSourceResponseClosingSpans(
  sourceResponse: string,
  normalizedCandidateLabels: Set<string>,
) {
  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
  if (tokens.length === 0) {
    return undefined
  }

  const candidateLabels = dedupeNonEmptyStrings([
    ...normalizedCandidateLabels,
    ...(normalizedCandidateLabels.size > 1
      ? []
      : inferEmbeddedClosingTopicCandidateLabels(sourceResponse, tokens)),
  ])
  const anchors = resolveEmbeddedTopicAnchors(
    sourceResponse,
    tokens,
    candidateLabels,
    'topic_closing_spans',
  )
  if (anchors.length === 0) {
    return undefined
  }

  if (anchors[0]?.startTokenIndex === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat topic_closing_spans requires each span to include at least one leading sentence before the topic-closing anchor.',
    )
  }

  const spans: TopicSourceResponseClosingSpan[] = []
  let previousEndTokenIndex = 0
  let previousEndOriginal = 0

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index] as EmbeddedTopicAnchor

    if (index > 0 && anchor.startTokenIndex === previousEndTokenIndex) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_closing_spans requires at least one leading sentence before the next topic-closing anchor.',
      )
    }

    const hasTrailingTokens = anchor.endTokenIndex < tokens.length
    if (index === anchors.length - 1 && hasTrailingTokens) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_closing_spans requires each span to end with a topic-closing sentence.',
      )
    }

    const nextTokenStartOriginal = tokens[anchor.endTokenIndex]?.start ?? sourceResponse.length
    const text = normalizeEmbeddedMatchingRunText(
      sourceResponse.slice(previousEndOriginal, nextTokenStartOriginal),
    )
    const matchingLabels = findMatchingNormalizedTopicLabels(
      normalizeSourceResponseText(text),
      normalizedCandidateLabels,
    )
    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple topic closing span anchors matched sentence "${text}" in sourceResponse.`,
      )
    }

    spans.push({
      text,
      closingText: text,
      normalizedClosingLabel: matchingLabels[0] ?? anchor.normalizedLabel,
    })
    previousEndTokenIndex = anchor.endTokenIndex
    previousEndOriginal = nextTokenStartOriginal
  }

  return spans
}

const EMBEDDED_TOPIC_SUMMARY_REJECT_TOKENS = new Set([
  'after',
  'and',
  'before',
  'because',
  'but',
  'or',
  'then',
])

function inferEmbeddedLeadingTopicCandidateLabels(
  sourceResponse: string,
  tokens: EmbeddedMatchingRunToken[],
) {
  if (startsWithNonPunctuatedWhClauseDeclarative(sourceResponse)) {
    return []
  }

  const labels: string[] = []

  for (const token of tokens) {
    const suffix = sourceResponse.slice(token.start)
    const summary = extractLeadingTopicSummary(suffix)
    if (!summary) {
      continue
    }

    const normalizedSummary = normalizeSourceResponseText(summary)
    if (!normalizedSummary) {
      continue
    }

    const summaryTokens = normalizedSummary.split(' ').filter(Boolean)
    if (summaryTokens.length < 2) {
      continue
    }
    if (summaryTokens.some((summaryToken) => EMBEDDED_TOPIC_SUMMARY_REJECT_TOKENS.has(summaryToken))) {
      continue
    }

    labels.push(normalizedSummary)
  }

  return dedupeNonEmptyStrings(labels)
}

function inferEmbeddedClosingTopicCandidateLabels(
  sourceResponse: string,
  tokens: EmbeddedMatchingRunToken[],
) {
  const labels: string[] = []

  for (const token of tokens) {
    const prefix = sourceResponse.slice(0, token.end)
    const summary = extractTrailingTopicSummary(prefix)
    if (!summary) {
      continue
    }

    const normalizedSummary = normalizeSourceResponseText(summary)
    if (!normalizedSummary) {
      continue
    }

    const summaryTokens = normalizedSummary.split(' ').filter(Boolean)
    if (summaryTokens.length < 2) {
      continue
    }
    if (summaryTokens.some((summaryToken) => EMBEDDED_TOPIC_SUMMARY_REJECT_TOKENS.has(summaryToken))) {
      continue
    }

    labels.push(normalizedSummary)
  }

  return dedupeNonEmptyStrings(labels)
}

function parseRequiredTopicSourceResponseClosingBlocks(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.topicClosingBlocks) {
    return sourceResponseState.topicClosingBlocks
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat topic_closing_blocks requires sourceResponse for ${label}.`,
    )
  }

  const blocks = parseTopicSourceResponseClosingBlocks(
    parseTopicSourceResponseParagraphs(shared),
    sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
  )
  if (sourceResponseState) {
    sourceResponseState.topicClosingBlocks = blocks
  }
  return blocks
}

function parseRequiredTopicSourceResponseParagraphs(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.topicParagraphs) {
    return sourceResponseState.topicParagraphs
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat topic_paragraphs requires sourceResponse for ${label}.`,
    )
  }

  const paragraphs = parseTopicSourceResponseParagraphs(shared)
  if (sourceResponseState) {
    sourceResponseState.topicParagraphs = paragraphs
  }
  return paragraphs
}

function parseRequiredTopicSourceResponseMiddleBlocks(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.topicMiddleBlocks) {
    return sourceResponseState.topicMiddleBlocks
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat topic_middle_blocks requires sourceResponse for ${label}.`,
    )
  }

  const blocks = parseTopicSourceResponseMiddleBlocks(
    parseTopicSourceResponseParagraphs(shared),
    sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
  )
  if (sourceResponseState) {
    sourceResponseState.topicMiddleBlocks = blocks
  }
  return blocks
}

function parseRequiredTopicSourceResponseBlocks(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.topicBlocks) {
    return sourceResponseState.topicBlocks
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat topic_blocks requires sourceResponse for ${label}.`,
    )
  }

  const blocks = parseTopicSourceResponseBlocks(
    parseTopicSourceResponseParagraphs(shared),
    sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
  )
  if (sourceResponseState) {
    sourceResponseState.topicBlocks = blocks
  }
  return blocks
}

function findLabeledSourceResponseSectionEntry(
  sectionsByLabel: Map<string, LabeledSourceResponseSection>,
  candidates: string[],
  consumedLabels?: Set<string>,
) {
  for (const candidate of candidates) {
    const normalizedLabel = normalizeSourceResponseLabel(candidate)
    const match = sectionsByLabel.get(normalizedLabel)
    if (match) {
      consumedLabels?.add(normalizedLabel)
      return match
    }
  }
  return undefined
}

function resolveContiguousMatchingIndexes(
  matchingIndexes: number[],
  multipleMatchErrorMessage: string,
) {
  for (let index = 1; index < matchingIndexes.length; index += 1) {
    const previousMatch = matchingIndexes[index - 1]
    const currentMatch = matchingIndexes[index]
    if (
      previousMatch === undefined ||
      currentMatch === undefined ||
      currentMatch !== previousMatch + 1
    ) {
      throw new AnswerInterpretationError(multipleMatchErrorMessage)
    }
  }

  return matchingIndexes
}

function markConsumedMatchingIndexes(
  consumedIndexes: Set<number> | undefined,
  matchingIndexes: number[],
) {
  if (!consumedIndexes) {
    return
  }

  for (const matchingIndex of matchingIndexes) {
    consumedIndexes.add(matchingIndex)
  }
}

function consumeContiguousQuestionSourceResponseMatch<
  T extends {
    question: string
    normalizedQuestionText: string
    normalizedQuestionCoreText: string
    answer: string
  },
>(
  matches: T[],
  matchingIndexes: number[],
  multipleMatchErrorMessage: string,
  consumedIndexes: Set<number> | undefined,
  joiner: string,
) {
  const contiguousMatchingIndexes = resolveContiguousMatchingIndexes(
    matchingIndexes,
    multipleMatchErrorMessage,
  )
  const firstMatchIndex = contiguousMatchingIndexes[0]
  if (firstMatchIndex === undefined) {
    return undefined
  }

  markConsumedMatchingIndexes(consumedIndexes, contiguousMatchingIndexes)
  const firstMatch = matches[firstMatchIndex]
  if (!firstMatch) {
    return undefined
  }
  if (contiguousMatchingIndexes.length === 1) {
    return firstMatch
  }

  return {
    ...firstMatch,
    answer: contiguousMatchingIndexes
      .map((matchingIndex) => matches[matchingIndex]?.answer)
      .filter((answer): answer is string => answer !== undefined)
      .join(joiner),
  }
}

function consumeContiguousTopicSourceResponseText(
  matches: Array<{ text: string }>,
  matchingIndexes: number[],
  multipleMatchErrorMessage: string,
  consumedIndexes: Set<number> | undefined,
  joiner: string,
  rejectMultipleInferredTopicSummaries = false,
) {
  const contiguousMatchingIndexes = resolveContiguousMatchingIndexes(
    matchingIndexes,
    multipleMatchErrorMessage,
  )
  const firstMatchIndex = contiguousMatchingIndexes[0]
  if (firstMatchIndex === undefined) {
    return undefined
  }

  if (rejectMultipleInferredTopicSummaries) {
    for (const matchingIndex of contiguousMatchingIndexes) {
      const text = matches[matchingIndex]?.text
      if (text && extractTopicAnchorCandidateSummariesFromText(text).length > 1) {
        throw new AnswerInterpretationError(multipleMatchErrorMessage)
      }
    }
  }

  markConsumedMatchingIndexes(consumedIndexes, contiguousMatchingIndexes)
  if (contiguousMatchingIndexes.length === 1) {
    return matches[firstMatchIndex]?.text
  }

  return contiguousMatchingIndexes
    .map((matchingIndex) => matches[matchingIndex]?.text)
    .filter((text): text is string => text !== undefined)
    .join(joiner)
}

function consumeQuestionBlockSourceResponseMatch(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const blocks = parseRequiredQuestionSourceResponseBlocks(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedQuestionBlockIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingQuestionBlockIndexes(blocks, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No question block matched ${label} in sourceResponse.`)
  }
  return consumeContiguousQuestionSourceResponseMatch(
    blocks,
    matchingIndexes,
    `Multiple question blocks matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedQuestionBlockIndexes,
    '\n\n',
  )
}

function consumeQuestionClauseSourceResponseMatch(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const clauses = parseRequiredQuestionSourceResponseClauses(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedQuestionClauseIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingQuestionSpanIndexes(clauses, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No question clause matched ${label} in sourceResponse.`)
  }
  return consumeContiguousQuestionSourceResponseMatch(
    clauses,
    matchingIndexes,
    `Multiple question clauses matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedQuestionClauseIndexes,
    ' ',
  )
}

function consumeQuestionSpanSourceResponseMatch(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const spans = parseRequiredQuestionSourceResponseSpans(sourceResponse, label, sourceResponseState)
  const consumedIndexes = sourceResponseState?.consumedQuestionSpanIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingQuestionSpanIndexes(spans, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No question span matched ${label} in sourceResponse.`)
  }
  return consumeContiguousQuestionSourceResponseMatch(
    spans,
    matchingIndexes,
    `Multiple question spans matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedQuestionSpanIndexes,
    ' ',
  )
}

function consumeQuestionMiddleSpanSourceResponseMatch(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const spans = parseRequiredQuestionSourceResponseMiddleSpans(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes =
    sourceResponseState?.consumedQuestionMiddleSpanIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingQuestionSpanIndexes(spans, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(
      `No question middle span matched ${label} in sourceResponse.`,
    )
  }
  return consumeContiguousQuestionSourceResponseMatch(
    spans,
    matchingIndexes,
    `Multiple question middle spans matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedQuestionMiddleSpanIndexes,
    ' ',
  )
}

function consumeQuestionClosingSpanSourceResponseMatch(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const spans = parseRequiredQuestionSourceResponseClosingSpans(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes =
    sourceResponseState?.consumedQuestionClosingSpanIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingQuestionClosingSpanIndexes(spans, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(
      `No question closing span matched ${label} in sourceResponse.`,
    )
  }
  return consumeContiguousQuestionSourceResponseMatch(
    spans,
    matchingIndexes,
    `Multiple question closing spans matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedQuestionClosingSpanIndexes,
    ' ',
  )
}

function consumeQuestionClosingBlockSourceResponseMatch(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const blocks = parseRequiredQuestionSourceResponseClosingBlocks(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes =
    sourceResponseState?.consumedQuestionClosingBlockIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingQuestionClosingBlockIndexes(
    blocks,
    candidates,
    consumedIndexes,
  )

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(
      `No question closing block matched ${label} in sourceResponse.`,
    )
  }
  return consumeContiguousQuestionSourceResponseMatch(
    blocks,
    matchingIndexes,
    `Multiple question closing blocks matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedQuestionClosingBlockIndexes,
    '\n\n',
  )
}

function consumeQuestionMiddleBlockSourceResponseMatch(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const blocks = parseRequiredQuestionSourceResponseMiddleBlocks(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes =
    sourceResponseState?.consumedQuestionMiddleBlockIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingQuestionBlockIndexes(blocks, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(
      `No question middle block matched ${label} in sourceResponse.`,
    )
  }
  return consumeContiguousQuestionSourceResponseMatch(
    blocks,
    matchingIndexes,
    `Multiple question middle blocks matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedQuestionMiddleBlockIndexes,
    '\n\n',
  )
}

function consumeQuestionBlockSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const match = consumeQuestionBlockSourceResponseMatch(
    sourceResponse,
    candidates,
    label,
    sourceResponseState,
    required,
  )
  return match?.answer
}

function consumeQuestionSpanSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const match = consumeQuestionSpanSourceResponseMatch(
    sourceResponse,
    candidates,
    label,
    sourceResponseState,
    required,
  )
  return match?.answer
}

function consumeQuestionClauseSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const match = consumeQuestionClauseSourceResponseMatch(
    sourceResponse,
    candidates,
    label,
    sourceResponseState,
    required,
  )
  return match?.answer
}

function consumeQuestionMiddleSpanSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const match = consumeQuestionMiddleSpanSourceResponseMatch(
    sourceResponse,
    candidates,
    label,
    sourceResponseState,
    required,
  )
  return match?.answer
}

function consumeQuestionClosingSpanSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const match = consumeQuestionClosingSpanSourceResponseMatch(
    sourceResponse,
    candidates,
    label,
    sourceResponseState,
    required,
  )
  return match?.answer
}

function consumeQuestionClosingBlockSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const match = consumeQuestionClosingBlockSourceResponseMatch(
    sourceResponse,
    candidates,
    label,
    sourceResponseState,
    required,
  )
  return match?.answer
}

function consumeQuestionMiddleBlockSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  const match = consumeQuestionMiddleBlockSourceResponseMatch(
    sourceResponse,
    candidates,
    label,
    sourceResponseState,
    required,
  )
  return match?.answer
}

function consumeTopicSentenceSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
  rejectMultipleInferredTopicSummaries = false,
) {
  const sentences = parseRequiredTopicSourceResponseSentences(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedTopicSentenceIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingTopicSentenceIndexes(sentences, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No topic sentence matched ${label} in sourceResponse.`)
  }
  for (const matchingIndex of matchingIndexes) {
    const text = sentences[matchingIndex]?.text
    if (text) {
      assertTopicTextHasSubstantiveLeadingAnswerContent(text, 'topic sentence')
      assertTopicAnswerTextDoesNotContainQuestionAuthority(text, 'Topic sentence')
    }
  }
  return consumeContiguousTopicSourceResponseText(
    sentences,
    matchingIndexes,
    `Multiple topic sentences matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicSentenceIndexes,
    ' ',
    rejectMultipleInferredTopicSummaries,
  )
}

function consumeTopicClauseSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
  rejectMultipleInferredTopicSummaries = false,
) {
  const clauses = parseRequiredTopicSourceResponseClauses(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedTopicClauseIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingTopicClauseIndexes(clauses, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No topic clause matched ${label} in sourceResponse.`)
  }
  for (const matchingIndex of matchingIndexes) {
    const text = clauses[matchingIndex]?.text
    if (text) {
      assertTopicTextHasSubstantiveLeadingAnswerContent(text, 'topic clause')
      assertTopicAnswerTextDoesNotContainQuestionAuthority(text, 'Topic clause')
    }
  }
  return consumeContiguousTopicSourceResponseText(
    clauses,
    matchingIndexes,
    `Multiple topic clauses matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicClauseIndexes,
    ' ',
    rejectMultipleInferredTopicSummaries,
  )
}

function consumeTopicSpanSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  registerTopicAnchorCandidates(sourceResponseState, [candidates])
  const spans = parseRequiredTopicSourceResponseSpans(sourceResponse, label, sourceResponseState)
  const consumedIndexes = sourceResponseState?.consumedTopicSpanIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingTopicSpanIndexes(spans, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No topic span matched ${label} in sourceResponse.`)
  }
  for (const matchingIndex of matchingIndexes) {
    const span = spans[matchingIndex]
    const anchorText = span?.anchorText
    if (anchorText) {
      assertTopicTextHasSubstantiveLeadingAnswerContent(anchorText, 'topic span anchor sentence')
    }
    if (span?.text) {
      assertTopicAnswerTextDoesNotContainQuestionAuthority(span.text, 'Topic span')
    }
  }
  return consumeContiguousTopicSourceResponseText(
    spans,
    matchingIndexes,
    `Multiple topic spans matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicSpanIndexes,
    ' ',
  )
}

function consumeTopicMiddleSpanSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  registerTopicAnchorCandidates(sourceResponseState, [candidates])
  const spans = parseRequiredTopicSourceResponseMiddleSpans(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedTopicMiddleSpanIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingTopicSpanIndexes(spans, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No topic middle span matched ${label} in sourceResponse.`)
  }
  for (const matchingIndex of matchingIndexes) {
    const span = spans[matchingIndex]
    const anchorText = span?.anchorText
    if (anchorText) {
      assertTopicTextHasSubstantiveLeadingAnswerContent(
        anchorText,
        'topic middle span anchor sentence',
      )
    }
    if (span?.text) {
      assertTopicAnswerTextDoesNotContainQuestionAuthority(span.text, 'Topic middle span')
    }
  }
  return consumeContiguousTopicSourceResponseText(
    spans,
    matchingIndexes,
    `Multiple topic middle spans matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicMiddleSpanIndexes,
    ' ',
  )
}

function consumeTopicClosingSpanSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
) {
  registerTopicAnchorCandidates(sourceResponseState, [candidates])
  const spans = parseRequiredTopicSourceResponseClosingSpans(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedTopicClosingSpanIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingTopicClosingSpanIndexes(spans, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No topic closing span matched ${label} in sourceResponse.`)
  }
  for (const matchingIndex of matchingIndexes) {
    const span = spans[matchingIndex]
    const closingText = span?.closingText
    if (closingText) {
      assertTopicTextHasSubstantiveLeadingAnswerContent(
        closingText,
        'topic closing span sentence',
      )
    }
    if (span?.text) {
      assertTopicAnswerTextDoesNotContainQuestionAuthority(span.text, 'Topic closing span')
    }
  }
  return consumeContiguousTopicSourceResponseText(
    spans,
    matchingIndexes,
    `Multiple topic closing spans matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicClosingSpanIndexes,
    ' ',
  )
}

function consumeTopicClosingBlockSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
  rejectMultipleInferredTopicSummaries = false,
) {
  registerTopicAnchorCandidates(sourceResponseState, [candidates])
  const blocks = parseRequiredTopicSourceResponseClosingBlocks(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedTopicClosingBlockIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingTopicClosingBlockIndexes(blocks, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(
      `No topic closing block matched ${label} in sourceResponse.`,
    )
  }
  if (rejectMultipleInferredTopicSummaries) {
    for (const matchingIndex of matchingIndexes) {
      const closingText = blocks[matchingIndex]?.closingText
      if (closingText && paragraphTextImpliesMultipleTopicSummaries(closingText)) {
        throw new AnswerInterpretationError(
          `Multiple topic closing blocks matched ${label} in sourceResponse.`,
        )
      }
    }
  }
  for (const matchingIndex of matchingIndexes) {
    const block = blocks[matchingIndex]
    const closingText = block?.closingText
    if (closingText) {
      assertTopicTextHasSubstantiveLeadingAnswerContent(
        closingText,
        'topic closing block paragraph',
      )
    }
    if (block?.text) {
      assertTopicAnswerTextDoesNotContainQuestionAuthority(block.text, 'Topic closing block')
    }
  }
  return consumeContiguousTopicSourceResponseText(
    blocks,
    matchingIndexes,
    `Multiple topic closing blocks matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicClosingBlockIndexes,
    '\n\n',
  )
}

function consumeTopicParagraphSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
  rejectMultipleInferredTopicSummaries = false,
) {
  const paragraphs = parseRequiredTopicSourceResponseParagraphs(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedTopicParagraphIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingTopicParagraphIndexes(paragraphs, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No topic paragraph matched ${label} in sourceResponse.`)
  }
  if (rejectMultipleInferredTopicSummaries) {
    for (const matchingIndex of matchingIndexes) {
      const text = paragraphs[matchingIndex]?.text
      if (text && paragraphTextImpliesMultipleTopicSummaries(text)) {
        throw new AnswerInterpretationError(
          `Multiple topic paragraphs matched ${label} in sourceResponse.`,
        )
      }
    }
  }
  for (const matchingIndex of matchingIndexes) {
    const text = paragraphs[matchingIndex]?.text
    if (text) {
      assertTopicTextHasSubstantiveLeadingAnswerContent(text, 'topic paragraph')
      assertTopicAnswerTextDoesNotContainQuestionAuthority(text, 'Topic paragraph')
    }
  }
  return consumeContiguousTopicSourceResponseText(
    paragraphs,
    matchingIndexes,
    `Multiple topic paragraphs matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicParagraphIndexes,
    '\n\n',
  )
}

function consumeTopicMiddleBlockSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
  rejectMultipleInferredTopicSummaries = false,
) {
  registerTopicAnchorCandidates(sourceResponseState, [candidates])
  const blocks = parseRequiredTopicSourceResponseMiddleBlocks(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const consumedIndexes = sourceResponseState?.consumedTopicMiddleBlockIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingTopicBlockIndexes(blocks, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No topic middle block matched ${label} in sourceResponse.`)
  }
  if (rejectMultipleInferredTopicSummaries) {
    for (const matchingIndex of matchingIndexes) {
      const anchorText = blocks[matchingIndex]?.anchorText
      if (anchorText && paragraphTextImpliesMultipleTopicSummaries(anchorText)) {
        throw new AnswerInterpretationError(
          `Multiple topic middle blocks matched ${label} in sourceResponse.`,
        )
      }
    }
  }
  for (const matchingIndex of matchingIndexes) {
    const block = blocks[matchingIndex]
    const anchorText = block?.anchorText
    if (anchorText) {
      assertTopicTextHasSubstantiveLeadingAnswerContent(
        anchorText,
        'topic middle block anchor paragraph',
      )
    }
    if (block?.text) {
      assertTopicAnswerTextDoesNotContainQuestionAuthority(block.text, 'Topic middle block')
    }
  }
  return consumeContiguousTopicSourceResponseText(
    blocks,
    matchingIndexes,
    `Multiple topic middle blocks matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicMiddleBlockIndexes,
    '\n\n',
  )
}

function consumeTopicBlockSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
  rejectMultipleInferredTopicSummaries = false,
) {
  registerTopicAnchorCandidates(sourceResponseState, [candidates])
  const blocks = parseRequiredTopicSourceResponseBlocks(sourceResponse, label, sourceResponseState)
  const consumedIndexes = sourceResponseState?.consumedTopicBlockIndexes ?? new Set<number>()
  const matchingIndexes = findMatchingTopicBlockIndexes(blocks, candidates, consumedIndexes)

  if (matchingIndexes.length === 0) {
    if (!required) {
      return undefined
    }
    throw new AnswerInterpretationError(`No topic block matched ${label} in sourceResponse.`)
  }
  if (rejectMultipleInferredTopicSummaries) {
    for (const matchingIndex of matchingIndexes) {
      const anchorText = blocks[matchingIndex]?.anchorText
      if (anchorText && paragraphTextImpliesMultipleTopicSummaries(anchorText)) {
        throw new AnswerInterpretationError(
          `Multiple topic blocks matched ${label} in sourceResponse.`,
        )
      }
    }
  }
  for (const matchingIndex of matchingIndexes) {
    const block = blocks[matchingIndex]
    const anchorText = block?.anchorText
    if (anchorText) {
      assertTopicTextHasSubstantiveLeadingAnswerContent(
        anchorText,
        'topic block anchor paragraph',
      )
    }
    if (block?.text) {
      assertTopicAnswerTextDoesNotContainQuestionAuthority(block.text, 'Topic block')
    }
  }
  return consumeContiguousTopicSourceResponseText(
    blocks,
    matchingIndexes,
    `Multiple topic blocks matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicBlockIndexes,
    '\n\n',
  )
}

function resolveOrderedSourceResponseItem(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const items = parseRequiredOrderedSourceResponseItems(sourceResponse, label, sourceResponseState)
  const nextIndex = sourceResponseState?.nextOrderedItemIndex ?? 0
  const nextItem = items[nextIndex]
  if (!nextItem) {
    throw new AnswerInterpretationError(`No ordered item remained for ${label} in sourceResponse.`)
  }
  if (sourceResponseState) {
    sourceResponseState.nextOrderedItemIndex = nextIndex + 1
  }
  return nextItem
}

function resolveOrderedSourceResponseBlock(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const blocks = parseRequiredOrderedSourceResponseBlocks(
    sourceResponse,
    label,
    sourceResponseState,
  )
  const nextIndex = sourceResponseState?.nextOrderedBlockIndex ?? 0
  const nextBlock = blocks[nextIndex]
  if (!nextBlock) {
    throw new AnswerInterpretationError(`No ordered block remained for ${label} in sourceResponse.`)
  }
  if (sourceResponseState) {
    sourceResponseState.nextOrderedBlockIndex = nextIndex + 1
  }
  return nextBlock
}

function parseRequiredOrderedSourceResponseItems(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.orderedItems) {
    return sourceResponseState.orderedItems
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat ordered_items requires sourceResponse for ${label}.`,
    )
  }

  const items = parseOrderedSourceResponseItems(shared)
  if (sourceResponseState) {
    sourceResponseState.orderedItems = items
  }
  return items
}

function parseRequiredPendingSourceResponseClauses(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.pendingClauses) {
    return sourceResponseState.pendingClauses
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat pending_clauses requires sourceResponse for ${label}.`,
    )
  }

  const clauses = parseGenericPendingSourceResponseClauses(shared)
  if (sourceResponseState) {
    sourceResponseState.pendingClauses = clauses
  }
  return clauses
}

function parseRequiredPendingSourceResponseParagraphs(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.pendingParagraphs) {
    return sourceResponseState.pendingParagraphs
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat pending_paragraphs requires sourceResponse for ${label}.`,
    )
  }

  const paragraphs = parseGenericPendingSourceResponseParagraphs(shared)
  if (sourceResponseState) {
    sourceResponseState.pendingParagraphs = paragraphs
  }
  return paragraphs
}

function parseRequiredPendingSourceResponseSentences(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.pendingSentences) {
    return sourceResponseState.pendingSentences
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat pending_sentences requires sourceResponse for ${label}.`,
    )
  }

  const sentences = parseGenericPendingSourceResponseSentences(shared)
  if (sourceResponseState) {
    sourceResponseState.pendingSentences = sentences
  }
  return sentences
}

function parseRequiredPendingSourceResponseConjunctions(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.pendingConjunctions) {
    return sourceResponseState.pendingConjunctions
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat pending_conjunctions requires sourceResponse for ${label}.`,
    )
  }

  const conjunctions = parsePendingSourceResponseConjunctions(shared)
  if (sourceResponseState) {
    sourceResponseState.pendingConjunctions = conjunctions
  }
  return conjunctions
}

function parseRequiredPendingAnswerSourceEntries(
  pendingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.pendingAnswerSourceEntries) {
    return sourceResponseState.pendingAnswerSourceEntries
  }

  if (!pendingAnswerSourceEntries || pendingAnswerSourceEntries.length === 0) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat pending_answer_sources requires answerSources for ${label}.`,
    )
  }

  if (sourceResponseState) {
    sourceResponseState.pendingAnswerSourceEntries = pendingAnswerSourceEntries
  }
  return pendingAnswerSourceEntries
}

function parseRequiredMatchingAnswerSourceEntries(
  matchingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.matchingAnswerSourceEntries) {
    return sourceResponseState.matchingAnswerSourceEntries
  }

  if (!matchingAnswerSourceEntries || matchingAnswerSourceEntries.length === 0) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_answer_sources requires answerSources for ${label}.`,
    )
  }

  if (sourceResponseState) {
    sourceResponseState.matchingAnswerSourceEntries = matchingAnswerSourceEntries
  }
  return matchingAnswerSourceEntries
}

function parseRequiredOrderedSourceResponseBlocks(
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseState?.orderedBlocks) {
    return sourceResponseState.orderedBlocks
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat ordered_blocks requires sourceResponse for ${label}.`,
    )
  }

  const blocks = parseOrderedSourceResponseBlocks(shared)
  assertOrderedBlocksDidNotCollapseMarkedOrderedItems(shared, blocks)
  if (sourceResponseState) {
    sourceResponseState.orderedBlocks = blocks
  }
  return blocks
}

function parseOrderedSourceResponseItems(sourceResponse: string) {
  const items: string[] = []
  for (const line of sourceResponse.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const value = stripLeadingPresentationListMarkers(trimmed)
    if (!value) {
      continue
    }
    items.push(value)
  }
  return items
}

function parseOrderedSourceResponseBlocks(sourceResponse: string) {
  return sourceResponse
    .split(/\r?\n\s*\r?\n\s*\r?\n+/)
    .map((block) => normalizeOrderedSourceResponseBlock(block))
    .filter(Boolean)
}

function sourceResponseHasMultipleMarkedOrderedLines(sourceResponse: string | undefined) {
  const shared = sourceResponse?.trim()
  if (!shared) {
    return false
  }

  let markedLineCount = 0
  for (const line of shared.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    if (stripLeadingPresentationListMarkers(trimmed) !== trimmed) {
      markedLineCount += 1
      if (markedLineCount > 1) {
        return true
      }
    }
  }

  return false
}

function orderedBlocksCollapsedMarkedOrderedItems(
  sourceResponse: string | undefined,
  blocks: string[] | undefined,
) {
  return (blocks?.length ?? 0) === 1 && sourceResponseHasMultipleMarkedOrderedLines(sourceResponse)
}

function assertOrderedBlocksDidNotCollapseMarkedOrderedItems(
  sourceResponse: string | undefined,
  blocks: string[],
) {
  if (!orderedBlocksCollapsedMarkedOrderedItems(sourceResponse, blocks)) {
    return
  }

  throw new AnswerInterpretationError(
    'sourceResponseFormat ordered_blocks rejected sourceResponse because it collapsed multiple ordered item lines into one ordered block.',
  )
}

function normalizeOrderedSourceResponseBlock(block: string) {
  const trimmed = block.trim()
  if (!trimmed) {
    return trimmed
  }

  const paragraphs = trimmed
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => normalizeExplicitTopicOrQuestionUnitText(paragraph))
    .filter(Boolean)
  if (paragraphs.length === 0) {
    return trimmed
  }

  return paragraphs.join('\n\n')
}

function parseQuestionSourceResponseBlocks(sourceResponse: string) {
  const paragraphs = sourceResponse
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => normalizeExplicitTopicOrQuestionUnitText(paragraph))
    .filter(Boolean)
  const blocks: QuestionSourceResponseBlock[] = []
  let currentQuestion: string | undefined
  let answerParagraphs: string[] = []

  for (const paragraph of paragraphs) {
    if (isQuestionSourceResponseParagraph(paragraph)) {
      const questionParagraph = normalizeQuestionSourceResponsePrompt(paragraph)
      if (currentQuestion) {
        if (answerParagraphs.length === 0) {
          throw new AnswerInterpretationError(
            `Question block "${currentQuestion}" in sourceResponse did not include an answer block.`,
          )
        }
        const answer = answerParagraphs.join('\n\n')
        assertQuestionAnswerTopicAuthorityMatchesQuestion(
          currentQuestion,
          answer,
          'Question block',
        )
        blocks.push({
          question: currentQuestion,
          normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
          normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
          answer,
        })
      } else if (answerParagraphs.length > 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_blocks requires sourceResponse to start with a question block.',
        )
      }
      currentQuestion = questionParagraph
      answerParagraphs = []
      continue
    }

    if (!currentQuestion) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_blocks requires sourceResponse to start with a question block.',
      )
    }
    answerParagraphs.push(paragraph)
  }

  if (!currentQuestion) {
    return blocks
  }
  if (answerParagraphs.length === 0) {
    throw new AnswerInterpretationError(
      `Question block "${currentQuestion}" in sourceResponse did not include an answer block.`,
    )
  }
  const finalBlockAnswer = answerParagraphs.join('\n\n')
  assertQuestionAnswerTopicAuthorityMatchesQuestion(
    currentQuestion,
    finalBlockAnswer,
    'Question block',
  )
  blocks.push({
    question: currentQuestion,
    normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
    normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
    answer: finalBlockAnswer,
  })
  return blocks
}

function parseQuestionSourceResponseClauses(sourceResponse: string) {
  const clauses = sourceResponse
    .split(/(?:\r?\n+|,+\s*|，+\s*|;+\s*|；+\s*)/)
    .map((clause) => clause.trim())
    .filter((sentence) => sentence.length > 0 && !isStandalonePresentationListMarker(sentence))
  const parsedClauses: QuestionSourceResponseSpan[] = []

  for (const clause of clauses) {
    const normalizedClause = stripLeadingQuestionPromptConjunction(clause)
    const match = /^(?<question>.+?[?？])\s*(?<answer>.*)$/u.exec(normalizedClause)?.groups
    const canonicalQuestionAnchor = match?.question
      ? undefined
      : resolveCanonicalQuestionAnchorMatch(
          normalizedClause,
          tokenizeEmbeddedMatchingRunSourceResponse(normalizedClause),
          0,
        )
    const clauseSentences = parseTopicSourceResponseSentences(normalizedClause)
    const question = match?.question
      ? normalizeQuestionSourceResponsePrompt(match.question)
      : canonicalQuestionAnchor?.canonicalPrompt
        ?? (clauseSentences[0] && isQuestionSourceResponseSentence(clauseSentences[0].text)
          ? normalizeQuestionSourceResponsePrompt(clauseSentences[0].text)
          : undefined)
    if (!question) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_clauses requires each clause to contain one question sentence followed by answer text.',
      )
    }

    const answer = normalizeExplicitTopicOrQuestionUnitText(
      match?.answer?.trim() ??
        (canonicalQuestionAnchor
          ? normalizedClause.slice(canonicalQuestionAnchor.endOriginal).trim()
          : clauseSentences.length > 1
            ? clauseSentences
                .slice(1)
                .map((sentence) => sentence.text)
                .join(' ')
            : '')
          .trim(),
    )
    if (!answer) {
      throw new AnswerInterpretationError(
        `Question clause "${question}" in sourceResponse did not include answer text.`,
      )
    }
    if (questionClauseAnswerContainsAdditionalQuestionAnchor(answer)) {
      throw new AnswerInterpretationError(
        `Question clause "${question}" in sourceResponse included another question anchor inside answer text.`,
      )
    }
    assertQuestionAnswerTopicAuthorityMatchesQuestion(question, answer, 'Question clause')

    parsedClauses.push({
      question,
      normalizedQuestionText: normalizeSourceResponseText(question),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(question),
      answer,
    })
  }

  return parsedClauses
}

const QUESTION_CLAUSE_INNER_CANONICAL_ANCHOR_PRECEDING_TOKENS = new Set(['and', 'but'])

function questionClauseAnswerContainsAdditionalQuestionAnchor(answer: string) {
  for (const sentence of parseTopicSourceResponseSentences(answer)) {
    if (isQuestionSourceResponseSentence(sentence.text)) {
      return true
    }

    const strippedSentence = stripLeadingQuestionPromptConjunction(sentence.text)
    const strippedTokens = tokenizeEmbeddedMatchingRunSourceResponse(strippedSentence)
    if (resolveCanonicalQuestionAnchorMatch(strippedSentence, strippedTokens, 0)) {
      return true
    }

    const sentenceTokens = tokenizeEmbeddedMatchingRunSourceResponse(sentence.text)
    for (let startTokenIndex = 1; startTokenIndex < sentenceTokens.length - 3; startTokenIndex += 1) {
      const previousToken = sentenceTokens[startTokenIndex - 1]?.normalizedText
      if (!QUESTION_CLAUSE_INNER_CANONICAL_ANCHOR_PRECEDING_TOKENS.has(previousToken ?? '')) {
        continue
      }
      if (resolveCanonicalQuestionAnchorMatch(sentence.text, sentenceTokens, startTokenIndex)) {
        return true
      }
    }
  }

  return false
}

function parseQuestionSourceResponseSpans(sourceResponse: string) {
  const sentences = parseTopicSourceResponseSentences(sourceResponse)
  const spans: QuestionSourceResponseSpan[] = []
  let currentQuestion: string | undefined
  let answerSentences: string[] = []

  for (const sentence of sentences) {
    if (isQuestionSourceResponseSentence(sentence.text)) {
      const questionSentence = normalizeQuestionSourceResponsePrompt(sentence.text)
      if (currentQuestion) {
        if (answerSentences.length === 0) {
          throw new AnswerInterpretationError(
            `Question span "${currentQuestion}" in sourceResponse did not include an answer sentence.`,
          )
        }
        const answer = answerSentences.join(' ')
        assertQuestionAnswerTopicAuthorityMatchesQuestion(
          currentQuestion,
          answer,
          'Question span',
        )
        spans.push({
          question: currentQuestion,
          normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
          normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
          answer,
        })
      } else if (answerSentences.length > 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_spans requires sourceResponse to start with a question sentence.',
        )
      }
      currentQuestion = questionSentence
      answerSentences = []
      continue
    }

    if (!currentQuestion) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_spans requires sourceResponse to start with a question sentence.',
      )
    }
    answerSentences.push(sentence.text)
  }

  if (!currentQuestion) {
    return spans
  }
  if (answerSentences.length === 0) {
    throw new AnswerInterpretationError(
      `Question span "${currentQuestion}" in sourceResponse did not include an answer sentence.`,
    )
  }
  const finalSpanAnswer = answerSentences.join(' ')
  assertQuestionAnswerTopicAuthorityMatchesQuestion(
    currentQuestion,
    finalSpanAnswer,
    'Question span',
  )
  spans.push({
    question: currentQuestion,
    normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
    normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
    answer: finalSpanAnswer,
  })
  return spans
}

function parseQuestionSourceResponseMiddleSpans(sourceResponse: string) {
  const sentences = parseTopicSourceResponseSentences(sourceResponse)
  const spans: QuestionSourceResponseSpan[] = []
  let currentLeadingSentences: string[] = []
  let currentQuestion: string | undefined
  let trailingSentences: string[] = []

  for (const sentence of sentences) {
    if (!isQuestionSourceResponseSentence(sentence.text)) {
      if (!currentQuestion) {
        currentLeadingSentences.push(sentence.text)
      } else {
        trailingSentences.push(sentence.text)
      }
      continue
    }

    if (!currentQuestion) {
      if (currentLeadingSentences.length === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_middle_spans requires each span to start with at least one leading sentence before the question sentence.',
        )
      }
      currentQuestion = normalizeQuestionSourceResponsePrompt(sentence.text)
      trailingSentences = []
      continue
    }

    if (trailingSentences.length < 2) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_spans requires at least one trailing sentence before the next question sentence and at least one leading sentence for that next span.',
      )
    }
    const answer = [...currentLeadingSentences, ...trailingSentences.slice(0, -1)].join(' ')
    assertQuestionAnswerTopicAuthorityMatchesQuestion(
      currentQuestion,
      answer,
      'Question middle span',
    )

    spans.push({
      question: currentQuestion,
      normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
      answer,
    })
    currentLeadingSentences = [trailingSentences[trailingSentences.length - 1] as string]
    currentQuestion = normalizeQuestionSourceResponsePrompt(sentence.text)
    trailingSentences = []
  }

  if (!currentQuestion) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_middle_spans requires at least one question anchor sentence with leading and trailing answer sentences.',
    )
  }
  if (trailingSentences.length === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_middle_spans requires each span to end with at least one trailing sentence after the question sentence.',
    )
  }
  const finalMiddleSpanAnswer = [...currentLeadingSentences, ...trailingSentences].join(' ')
  assertQuestionAnswerTopicAuthorityMatchesQuestion(
    currentQuestion,
    finalMiddleSpanAnswer,
    'Question middle span',
  )
  spans.push({
    question: currentQuestion,
    normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
    normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
    answer: finalMiddleSpanAnswer,
  })
  return spans
}

function parseQuestionSourceResponseClosingSpans(sourceResponse: string) {
  const sentences = parseTopicSourceResponseSentences(sourceResponse)
  const spans: QuestionSourceResponseClosingSpan[] = []
  let pendingAnswerSentences: string[] = []

  for (const sentence of sentences) {
    if (!isQuestionSourceResponseSentence(sentence.text)) {
      pendingAnswerSentences.push(sentence.text)
      continue
    }

    const questionSentence = normalizeQuestionSourceResponsePrompt(sentence.text)

    if (pendingAnswerSentences.length === 0) {
      throw new AnswerInterpretationError(
        `Question closing span "${questionSentence}" in sourceResponse did not include an answer sentence.`,
      )
    }
    const answer = pendingAnswerSentences.join(' ')
    assertQuestionAnswerTopicAuthorityMatchesQuestion(
      questionSentence,
      answer,
      'Question closing span',
    )

    spans.push({
      question: questionSentence,
      normalizedQuestionText: normalizeSourceResponseText(questionSentence),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(questionSentence),
      answer,
    })
    pendingAnswerSentences = []
  }

  if (pendingAnswerSentences.length > 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_closing_spans requires each span to end with a question sentence.',
    )
  }

  return spans
}

function parseQuestionSourceResponseClosingBlocks(sourceResponse: string) {
  const paragraphs = parseTopicSourceResponseParagraphs(sourceResponse)
  const blocks: QuestionSourceResponseClosingBlock[] = []
  let pendingAnswerParagraphs: string[] = []

  for (const paragraph of paragraphs) {
    if (!isQuestionSourceResponseParagraph(paragraph.text)) {
      pendingAnswerParagraphs.push(paragraph.text)
      continue
    }

    const questionParagraph = normalizeQuestionSourceResponsePrompt(paragraph.text)

    if (pendingAnswerParagraphs.length === 0) {
      throw new AnswerInterpretationError(
        `Question closing block "${questionParagraph}" in sourceResponse did not include an answer block.`,
      )
    }
    const answer = pendingAnswerParagraphs.join('\n\n')
    assertQuestionAnswerTopicAuthorityMatchesQuestion(
      questionParagraph,
      answer,
      'Question closing block',
    )

    blocks.push({
      question: questionParagraph,
      normalizedQuestionText: normalizeSourceResponseText(questionParagraph),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(questionParagraph),
      answer,
    })
    pendingAnswerParagraphs = []
  }

  if (pendingAnswerParagraphs.length > 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_closing_blocks requires each block to end with a question paragraph.',
    )
  }

  return blocks
}

function parseQuestionSourceResponseMiddleBlocks(sourceResponse: string) {
  const paragraphs = parseTopicSourceResponseParagraphs(sourceResponse)
  const blocks: QuestionSourceResponseBlock[] = []
  let currentLeadingParagraphs: string[] = []
  let currentQuestion: string | undefined
  let trailingParagraphs: string[] = []

  for (const paragraph of paragraphs) {
    if (!isQuestionSourceResponseParagraph(paragraph.text)) {
      if (!currentQuestion) {
        currentLeadingParagraphs.push(paragraph.text)
      } else {
        trailingParagraphs.push(paragraph.text)
      }
      continue
    }

    if (!currentQuestion) {
      if (currentLeadingParagraphs.length === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_middle_blocks requires each block to start with at least one leading paragraph before the question paragraph.',
        )
      }
      currentQuestion = normalizeQuestionSourceResponsePrompt(paragraph.text)
      trailingParagraphs = []
      continue
    }

    if (trailingParagraphs.length < 2) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_blocks requires at least one trailing paragraph before the next question paragraph and at least one leading paragraph for that next block.',
      )
    }
    const answer = [...currentLeadingParagraphs, ...trailingParagraphs.slice(0, -1)].join('\n\n')
    assertQuestionAnswerTopicAuthorityMatchesQuestion(
      currentQuestion,
      answer,
      'Question middle block',
    )

    blocks.push({
      question: currentQuestion,
      normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
      answer,
    })
    currentLeadingParagraphs = [trailingParagraphs[trailingParagraphs.length - 1] as string]
    currentQuestion = normalizeQuestionSourceResponsePrompt(paragraph.text)
    trailingParagraphs = []
  }

  if (!currentQuestion) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_middle_blocks requires at least one question anchor paragraph with leading and trailing answer paragraphs.',
    )
  }
  if (trailingParagraphs.length === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_middle_blocks requires each block to end with at least one trailing paragraph after the question paragraph.',
    )
  }
  const finalMiddleBlockAnswer = [...currentLeadingParagraphs, ...trailingParagraphs].join(
    '\n\n',
  )
  assertQuestionAnswerTopicAuthorityMatchesQuestion(
    currentQuestion,
    finalMiddleBlockAnswer,
    'Question middle block',
  )
  blocks.push({
    question: currentQuestion,
    normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
    normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
    answer: finalMiddleBlockAnswer,
  })
  return blocks
}

function isQuestionSourceResponseParagraph(paragraph: string) {
  const trimmed = stripLeadingQuestionPromptConjunction(paragraph)
  return (
    /[?？]\s*$/u.test(trimmed) ||
    Boolean(inferCanonicalQuestionAnchorSummary(trimmed)) ||
    Boolean(inferNonPunctuatedInterrogativeQuestionAuthority(trimmed))
  )
}

function normalizeQuestionSourceResponsePrompt(question: string) {
  const trimmed = stripLeadingQuestionPromptConjunction(question)
  if (!trimmed || /[?？]\s*$/u.test(trimmed)) {
    return normalizeExplicitQuestionSurfaceText(trimmed)
  }
  if (inferCanonicalQuestionAnchorSummary(trimmed)) {
    return normalizeEmbeddedQuestionAnchorText(trimmed)
  }
  const nonPunctuatedQuestionAuthority = inferNonPunctuatedInterrogativeQuestionAuthority(trimmed)
  if (nonPunctuatedQuestionAuthority) {
    return nonPunctuatedQuestionAuthority
  }
  return normalizeEmbeddedQuestionAnchorText(trimmed)
}

function isQuestionSourceResponseSentence(sentence: string) {
  const trimmed = stripLeadingQuestionPromptConjunction(sentence)
  return (
    /[?？]\s*$/u.test(trimmed) ||
    Boolean(inferCanonicalQuestionAnchorSummary(trimmed)) ||
    Boolean(inferNonPunctuatedInterrogativeQuestionAuthority(trimmed))
  )
}

function parseTopicSourceResponseSentences(sourceResponse: string) {
  return sourceResponse
    .split(/(?:\r?\n+|;+\s*|；+\s*|(?<=[.?!。？！])\s+)/)
    .map((sentence) => normalizeExplicitTopicOrQuestionUnitText(sentence))
    .filter((sentence) => sentence.length > 0 && !isStandalonePresentationListMarker(sentence))
    .map((sentence) => ({
      text: sentence,
      normalizedText: normalizeSourceResponseText(sentence),
    }))
}

function parseTopicSourceResponseClauses(sourceResponse: string) {
  return sourceResponse
    .split(/(?:\r?\n+|,+\s*|，+\s*|;+\s*|；+\s*|(?<=[.?!。？！])\s+)/)
    .map((clause) => normalizeExplicitTopicOrQuestionUnitText(clause))
    .filter((clause) => clause.length > 0 && !isStandalonePresentationListMarker(clause))
    .map((clause) => ({
      text: clause,
      normalizedText: normalizeSourceResponseText(clause),
    }))
}

function parseEmbeddedTopicSourceResponseClauses(
  sourceResponse: string,
  normalizedCandidateLabels: Set<string>,
) {
  const segments = parsePendingSourceResponseConjunctions(sourceResponse)
  if (segments.length <= 1) {
    return undefined
  }

  const clauses = segments.map((segment) => ({
    text: segment,
    normalizedText: normalizeSourceResponseText(segment),
  }))

  for (const clause of clauses) {
    const matchingLabels = findMatchingNormalizedTopicLabels(
      clause.normalizedText,
      normalizedCandidateLabels,
    )
    const anchorLabel = resolveSingleTopicAnchorLabel(
      clause.text,
      matchingLabels,
      `Multiple topic clause anchors matched conjunction segment "${clause.text}" in sourceResponse.`,
      inferNormalizedTopicAnchorLabelsFromText,
    )
    if (!anchorLabel) {
      return undefined
    }
  }

  return clauses
}

function parseTopicSourceResponseParagraphs(sourceResponse: string) {
  return sourceResponse
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => normalizeExplicitTopicOrQuestionUnitText(paragraph))
    .filter((paragraph) => paragraph.length > 0 && !isStandalonePresentationListMarker(paragraph))
    .map((paragraph) => ({
      text: paragraph,
      normalizedText: normalizeSourceResponseText(paragraph),
    }))
}

function normalizeExplicitTopicOrQuestionUnitText(text: string) {
  return stripLeadingPresentationListMarkers(text.trim())
}

function normalizeGenericPendingOrMatchingUnitText(text: string) {
  return stripLeadingPresentationListMarkers(text.trim())
}

function normalizeEmbeddedMatchingRunText(text: string) {
  return stripStandalonePresentationListMarkerTokens(
    stripTrailingPresentationListMarkers(stripLeadingPresentationListMarkers(text.trim())),
  )
}

function parseGenericPendingSourceResponseClauses(sourceResponse: string) {
  return parseTopicSourceResponseClauses(sourceResponse)
    .map((clause) => normalizeGenericPendingOrMatchingUnitText(clause.text))
    .filter(Boolean)
}

function parseGenericPendingSourceResponseParagraphs(sourceResponse: string) {
  return parseTopicSourceResponseParagraphs(sourceResponse)
    .map((paragraph) => normalizeGenericPendingOrMatchingUnitText(paragraph.text))
    .filter(Boolean)
}

function parseGenericPendingSourceResponseSentences(sourceResponse: string) {
  return parseTopicSourceResponseSentences(sourceResponse)
    .map((sentence) => normalizeGenericPendingOrMatchingUnitText(sentence.text))
    .filter(Boolean)
}

function parseGenericMatchingSourceResponseParagraphUnits(sourceResponse: string) {
  return parseTopicSourceResponseParagraphs(sourceResponse)
    .map((paragraph) => normalizeGenericPendingOrMatchingUnitText(paragraph.text))
    .filter(Boolean)
    .map((text) => ({
      text,
      normalizedText: normalizeSourceResponseText(text),
    }))
}

function parseGenericMatchingSourceResponseSentenceUnits(sourceResponse: string) {
  return parseTopicSourceResponseSentences(sourceResponse)
    .map((sentence) => normalizeGenericPendingOrMatchingUnitText(sentence.text))
    .filter(Boolean)
    .map((text) => ({
      text,
      normalizedText: normalizeSourceResponseText(text),
    }))
}

function parseGenericMatchingSourceResponseClauseUnits(sourceResponse: string) {
  return parseTopicSourceResponseClauses(sourceResponse)
    .map((clause) => normalizeGenericPendingOrMatchingUnitText(clause.text))
    .filter(Boolean)
    .map((text) => ({
      text,
      normalizedText: normalizeSourceResponseText(text),
    }))
}

function parsePendingSourceResponseConjunctions(sourceResponse: string) {
  const normalizedSourceResponse = normalizeGenericPendingOrMatchingUnitText(sourceResponse)
  if (!normalizedSourceResponse) {
    return []
  }

  if (sourceResponseStartsWithProtectedLeadingConjunctionSequence(normalizedSourceResponse)) {
    return [normalizedSourceResponse]
  }

  return normalizedSourceResponse
    .split(/\s+(?:and then|then|and)\s+/i)
    .map((segment) => normalizeGenericPendingOrMatchingUnitText(segment))
    .filter(Boolean)
}

function parseTopicSourceResponseSpans(
  sentences: TopicSourceResponseSentence[],
  normalizedCandidateLabels: Set<string>,
) {
  const spans: TopicSourceResponseSpan[] = []
  let currentSpan: TopicSourceResponseSpan | undefined

  for (const sentence of sentences) {
    const matchingLabels = findMatchingNormalizedTopicLabels(
      sentence.normalizedText,
      normalizedCandidateLabels,
    )

    const anchorLabel = resolveSingleTopicAnchorLabel(
      sentence.text,
      matchingLabels,
      `Multiple topic span anchors matched sentence "${sentence.text}" in sourceResponse.`,
      inferTopicSpanAnchorLabelsFromSentence,
    )
    if (anchorLabel) {
      if (currentSpan) {
        spans.push(currentSpan)
      }
      currentSpan = {
        text: sentence.text,
        anchorText: sentence.text,
        normalizedAnchorLabel: anchorLabel,
      }
      continue
    }

    if (!currentSpan) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_spans requires sourceResponse to start with a topic anchor sentence.',
      )
    }

    currentSpan = {
      ...currentSpan,
      text: `${currentSpan.text} ${sentence.text}`,
    }
  }

  if (currentSpan) {
    spans.push(currentSpan)
  }

  return spans
}

function parseTopicSourceResponseMiddleSpans(
  sentences: TopicSourceResponseSentence[],
  normalizedCandidateLabels: Set<string>,
) {
  const spans: TopicSourceResponseSpan[] = []
  let currentLeadingSentences: string[] = []
  let currentAnchor: TopicSourceResponseSentence | undefined
  let currentAnchorLabel: string | undefined
  let trailingSentences: string[] = []

  for (const sentence of sentences) {
    const matchingLabels = findMatchingNormalizedTopicLabels(
      sentence.normalizedText,
      normalizedCandidateLabels,
    )

    const anchorLabel = resolveSingleTopicAnchorLabel(
      sentence.text,
      matchingLabels,
      `Multiple topic middle span anchors matched sentence "${sentence.text}" in sourceResponse.`,
      inferTopicSpanAnchorLabelsFromSentence,
    )
    if (!anchorLabel) {
      if (!currentAnchor) {
        currentLeadingSentences.push(sentence.text)
      } else {
        trailingSentences.push(sentence.text)
      }
      continue
    }

    if (!currentAnchor) {
      if (currentLeadingSentences.length === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_middle_spans requires each span to start with at least one leading sentence before the topic anchor sentence.',
        )
      }
      currentAnchor = sentence
      currentAnchorLabel = anchorLabel
      trailingSentences = []
      continue
    }

    if (trailingSentences.length < 2) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_middle_spans requires at least one trailing sentence before the next topic anchor sentence and at least one leading sentence for that next span.',
      )
    }

    spans.push({
      text: [
        ...currentLeadingSentences,
        currentAnchor.text,
        ...trailingSentences.slice(0, -1),
      ].join(' '),
      anchorText: currentAnchor.text,
      normalizedAnchorLabel: currentAnchorLabel ?? currentAnchor.normalizedText,
    })
    currentLeadingSentences = [trailingSentences[trailingSentences.length - 1] as string]
    currentAnchor = sentence
    currentAnchorLabel = anchorLabel
    trailingSentences = []
  }

  if (!currentAnchor) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat topic_middle_spans requires at least one topic anchor sentence with leading and trailing continuation sentences.',
    )
  }

  if (trailingSentences.length === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat topic_middle_spans requires each span to end with at least one trailing sentence after the topic anchor sentence.',
    )
  }

  spans.push({
    text: [...currentLeadingSentences, currentAnchor.text, ...trailingSentences].join(' '),
    anchorText: currentAnchor.text,
    normalizedAnchorLabel: currentAnchorLabel ?? currentAnchor.normalizedText,
  })

  return spans
}

function parseTopicSourceResponseClosingSpans(
  sentences: TopicSourceResponseSentence[],
  normalizedCandidateLabels: Set<string>,
) {
  const spans: TopicSourceResponseClosingSpan[] = []
  let pendingSentences: string[] = []

  for (const sentence of sentences) {
    pendingSentences.push(sentence.text)
    const matchingLabels = findMatchingNormalizedTopicLabels(
      sentence.normalizedText,
      normalizedCandidateLabels,
    )

    const closingLabel = resolveSingleTopicAnchorLabel(
      sentence.text,
      matchingLabels,
      `Multiple topic closing span anchors matched sentence "${sentence.text}" in sourceResponse.`,
      inferTopicClosingSpanLabelsFromSentence,
    )
    if (!closingLabel) {
      continue
    }

    spans.push({
      text: pendingSentences.join(' '),
      closingText: sentence.text,
      normalizedClosingLabel: closingLabel,
    })
    pendingSentences = []
  }

  if (pendingSentences.length > 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat topic_closing_spans requires each span to end with a topic-closing sentence.',
    )
  }

  return spans
}

function parseTopicSourceResponseClosingBlocks(
  paragraphs: TopicSourceResponseParagraph[],
  normalizedCandidateLabels: Set<string>,
) {
  const blocks: TopicSourceResponseClosingBlock[] = []
  let pendingParagraphs: string[] = []

  for (const paragraph of paragraphs) {
    pendingParagraphs.push(paragraph.text)
    const matchingLabels = findMatchingNormalizedTopicLabels(
      paragraph.normalizedText,
      normalizedCandidateLabels,
    )

    const closingLabel = resolveSingleTopicAnchorLabel(
      paragraph.text,
      matchingLabels,
      `Multiple topic closing block anchors matched paragraph "${paragraph.text}" in sourceResponse.`,
      inferTopicClosingBlockLabelsFromParagraph,
    )
    if (!closingLabel) {
      continue
    }

    blocks.push({
      text: pendingParagraphs.join('\n\n'),
      closingText: paragraph.text,
      normalizedClosingLabel: closingLabel,
    })
    pendingParagraphs = []
  }

  if (pendingParagraphs.length > 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat topic_closing_blocks requires each block to end with a topic-closing paragraph.',
    )
  }

  return blocks
}

function parseTopicSourceResponseBlocks(
  paragraphs: TopicSourceResponseParagraph[],
  normalizedCandidateLabels: Set<string>,
) {
  const blocks: TopicSourceResponseBlock[] = []
  let currentBlock: TopicSourceResponseBlock | undefined

  for (const paragraph of paragraphs) {
    const matchingLabels = findMatchingNormalizedTopicLabels(
      paragraph.normalizedText,
      normalizedCandidateLabels,
    )

    const anchorLabel = resolveSingleTopicAnchorLabel(
      paragraph.text,
      matchingLabels,
      `Multiple topic block anchors matched paragraph "${paragraph.text}" in sourceResponse.`,
      inferTopicBlockAnchorLabelsFromParagraph,
    )
    if (anchorLabel) {
      if (currentBlock) {
        blocks.push(currentBlock)
      }
      currentBlock = {
        text: paragraph.text,
        anchorText: paragraph.text,
        normalizedAnchorLabel: anchorLabel,
      }
      continue
    }

    if (!currentBlock) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_blocks requires sourceResponse to start with a topic anchor paragraph.',
      )
    }

    currentBlock = {
      ...currentBlock,
      text: `${currentBlock.text}\n\n${paragraph.text}`,
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock)
  }

  return blocks
}

function parseTopicSourceResponseMiddleBlocks(
  paragraphs: TopicSourceResponseParagraph[],
  normalizedCandidateLabels: Set<string>,
) {
  const blocks: TopicSourceResponseBlock[] = []
  let currentLeadingParagraphs: string[] = []
  let currentAnchor: TopicSourceResponseParagraph | undefined
  let currentAnchorLabel: string | undefined
  let trailingParagraphs: string[] = []

  for (const paragraph of paragraphs) {
    const matchingLabels = findMatchingNormalizedTopicLabels(
      paragraph.normalizedText,
      normalizedCandidateLabels,
    )

    const anchorLabel = resolveSingleTopicAnchorLabel(
      paragraph.text,
      matchingLabels,
      `Multiple topic middle block anchors matched paragraph "${paragraph.text}" in sourceResponse.`,
      inferTopicBlockAnchorLabelsFromParagraph,
    )
    if (!anchorLabel) {
      if (!currentAnchor) {
        currentLeadingParagraphs.push(paragraph.text)
      } else {
        trailingParagraphs.push(paragraph.text)
      }
      continue
    }

    if (!currentAnchor) {
      if (currentLeadingParagraphs.length === 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_middle_blocks requires each block to start with at least one leading paragraph before the topic anchor paragraph.',
        )
      }
      currentAnchor = paragraph
      currentAnchorLabel = anchorLabel
      trailingParagraphs = []
      continue
    }

    if (trailingParagraphs.length < 2) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_middle_blocks requires at least one trailing paragraph before the next topic anchor paragraph and at least one leading paragraph for that next block.',
      )
    }

    blocks.push({
      text: [
        ...currentLeadingParagraphs,
        currentAnchor.text,
        ...trailingParagraphs.slice(0, -1),
      ].join('\n\n'),
      anchorText: currentAnchor.text,
      normalizedAnchorLabel: currentAnchorLabel ?? currentAnchor.normalizedText,
    })
    currentLeadingParagraphs = [trailingParagraphs[trailingParagraphs.length - 1] as string]
    currentAnchor = paragraph
    currentAnchorLabel = anchorLabel
    trailingParagraphs = []
  }

  if (!currentAnchor) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat topic_middle_blocks requires at least one topic anchor paragraph with leading and trailing continuation paragraphs.',
    )
  }

  if (trailingParagraphs.length === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat topic_middle_blocks requires each block to end with at least one trailing paragraph after the topic anchor paragraph.',
    )
  }

  blocks.push({
    text: [...currentLeadingParagraphs, currentAnchor.text, ...trailingParagraphs].join('\n\n'),
    anchorText: currentAnchor.text,
    normalizedAnchorLabel: currentAnchorLabel ?? currentAnchor.normalizedText,
  })

  return blocks
}

function parseLabeledSourceResponseSections(sourceResponse: string) {
  const sectionsByLabel = new Map<string, LabeledSourceResponseSection>()
  for (const [lineIndex, line] of sourceResponse.split(/\r?\n/).entries()) {
    const trimmed = stripLeadingPresentationListMarkers(line.trim())
    if (!trimmed) {
      continue
    }
    const match = /^(?:[-*•]\s*)?([^:：]+?)\s*[:：]\s*(.+)$/.exec(trimmed)
    if (!match) {
      continue
    }
    const rawLabel = match[1]?.trim()
    const value = normalizeExplicitTopicOrQuestionUnitText(match[2] ?? '')
    if (!rawLabel || !value) {
      continue
    }
    assertExplicitLabelTextDoesNotContainAuthority(rawLabel, 'Labeled section label')
    if (labeledSectionValueStartsWithNestedSameSummaryLabel(rawLabel, value)) {
      throw new AnswerInterpretationError(
        `Labeled section "${rawLabel}" in sourceResponse included another labeled section inside its value.`,
      )
    }
    if (labeledSectionValueContainsAdditionalLabeledSentence(value)) {
      throw new AnswerInterpretationError(
        `Labeled section "${rawLabel}" in sourceResponse included another labeled section inside its value.`,
      )
    }
    const normalized = normalizeSourceResponseLabel(rawLabel)
    if (sectionsByLabel.has(normalized)) {
      throw new AnswerInterpretationError(
        `Duplicate labeled section "${rawLabel}" in sourceResponse.`,
      )
    }
    sectionsByLabel.set(normalized, {
      label: rawLabel,
      value,
      sourceLineIndex: lineIndex,
    })
  }
  return sectionsByLabel
}

function assertExplicitLabelTextDoesNotContainAuthority(label: string, unitLabel: string) {
  const questionAuthorities = extractQuestionAuthorityTextsFromText(label)
  if (questionAuthorities.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} "${label}" in sourceResponse included question authority ${formatQuotedValueList(questionAuthorities)} inside label text.`,
    )
  }

  const topicAuthorities = extractInferredTopicSummaries(label)
  if (topicAuthorities.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} "${label}" in sourceResponse included topic authority for ${formatQuotedValueList(topicAuthorities)} inside label text.`,
    )
  }

  const incompleteSummary = extractIncompleteLeadingTopicAuthoritySummary(label)
  if (!incompleteSummary) {
    return
  }

  throw new AnswerInterpretationError(
    `${unitLabel} "${label}" in sourceResponse included incomplete topic authority for ${formatQuotedValueList([incompleteSummary])} inside label text.`,
  )
}

function labeledSectionValueStartsWithNestedSameSummaryLabel(label: string, value: string) {
  const firstSentence = parseTopicSourceResponseSentences(value)[0]?.text
  if (!firstSentence) {
    return false
  }

  const nested = parseInlineTopicClause(firstSentence)
  if (!nested) {
    return false
  }

  const expectedSummary = inferComparableExplicitLabelSummary(label)
  const nestedSummary = inferComparableExplicitLabelSummary(nested.label)
  if (!expectedSummary || !nestedSummary) {
    return false
  }

  return normalizeSourceResponseLabel(expectedSummary) === normalizeSourceResponseLabel(nestedSummary)
}

function labeledSectionValueContainsAdditionalLabeledSentence(value: string) {
  const sentences = parseTopicSourceResponseSentences(value)
  for (const sentence of sentences.slice(1)) {
    if (parseInlineTopicClause(sentence.text)) {
      return true
    }
  }
  return false
}

function parseInlineTopicSections(sourceResponse: string) {
  const sectionsByLabel = new Map<string, LabeledSourceResponseSection>()
  const clauses = splitInlineTopicClauses(sourceResponse)

  for (const [clauseIndex, clause] of clauses.entries()) {
    const parsed = parseInlineTopicClause(clause)
    if (!parsed) {
      continue
    }

    const trimmedClause = stripLeadingPresentationListMarkers(
      clause.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (inlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause)) {
      assertExplicitLabelTextDoesNotContainAuthority(parsed.label, 'Inline topic clause label')
    }
    const normalized = normalizeSourceResponseLabel(parsed.label)
    if (sectionsByLabel.has(normalized)) {
      throw new AnswerInterpretationError(
        `Duplicate inline topic clause "${parsed.label}" in sourceResponse.`,
      )
    }
    sectionsByLabel.set(normalized, {
      ...parsed,
      sourceClauseIndex: clauseIndex,
    })
  }

  return sectionsByLabel
}

function splitInlineTopicClauses(sourceResponse: string) {
  const rawClauses = sourceResponse
    .split(/(?:\r?\n+|;+\s*|；+\s*|(?<=[.?!。？！])\s+)/)
    .map((clause) => clause.trim())
    .filter(Boolean)

  const clauses: string[] = []
  for (const clause of rawClauses) {
    const previousClause = clauses.at(-1)
    if (previousClause && shouldMergeWithFollowingInlineTopicClause(previousClause)) {
      clauses[clauses.length - 1] = `${previousClause} ${clause}`.trim()
      continue
    }
    clauses.push(clause)
  }

  return clauses
}

function shouldMergeWithFollowingInlineTopicClause(clause: string) {
  const trimmed = stripLeadingPresentationListMarkers(
    clause.trim().replace(/^(?:and|but)\s+/i, ''),
  )
  if (!trimmed || /[.?!。？！]$/u.test(trimmed)) {
    return false
  }

  if (/^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*$/u.test(trimmed)) {
    return true
  }

  if (/^(?<label>.+?)\s+(?:-|－|–|—)\s*$/u.test(trimmed)) {
    return true
  }

  const verbal = new RegExp(
    `^(?<label>.+?)\\s+(?<answer>${TOPIC_SUMMARY_VERB_PATTERN}\\b.*)$`,
    'i',
  ).exec(trimmed)?.groups

  return Boolean(
    verbal?.answer && !topicPredicateIncludesSubstantiveAnswerContent(verbal.answer),
  )
}

const LEADING_COMMON_ROMAN_OUTLINE_PAREN_MARKER_PATTERN =
  /^(?:(?:\([IVXivx]{2,8}\)|（[IVXivx]{2,8}）)\s*)+/u
const LEADING_COMMON_ROMAN_OUTLINE_MARKER_PATTERN = /^(?:(?:[IVX]{2,8}[.)])\s*)+/u
const STANDALONE_COMMON_ROMAN_OUTLINE_MARKER_PATTERN =
  /^(?:[IVX]{2,8}[.)]|\([IVXivx]{2,8}\)|（[IVXivx]{2,8}）)$/u
const LEADING_FULLWIDTH_NUMBER_PAREN_MARKER_PATTERN =
  /^(?:(?:\([０-９]+\)|（[０-９]+）)\s*)+/u
const LEADING_FULLWIDTH_NUMBER_MARKER_PATTERN =
  /^(?:(?:[０-９]+[．.)）])\s*)+/u
const LEADING_CIRCLED_NUMBER_MARKER_PATTERN = /^(?:[①-⑳]\s*)+/u
const LEADING_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN =
  /^(?:(?:\d+|[０-９]+|[一二三四五六七八九十百千]+)、\s*)+/u
const LEADING_CJK_NUMBER_PAREN_MARKER_PATTERN =
  /^(?:(?:\([一二三四五六七八九十百千]+\)|（[一二三四五六七八九十百千]+）)\s*)+/u
const STANDALONE_FULLWIDTH_NUMBER_MARKER_PATTERN =
  /^(?:[０-９]+[．.)）]|\([０-９]+\)|（[０-９]+）|[①-⑳])$/u
const STANDALONE_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN =
  /^(?:\d+、|[０-９]+、|[一二三四五六七八九十百千]+、|\([一二三四五六七八九十百千]+\)|（[一二三四五六七八九十百千]+）)$/u

function stripLeadingPresentationListMarkers(text: string) {
  let stripped = text.trim()
  while (stripped) {
    const next = stripped
      .replace(/^(?:#{1,6}\s+)+/u, '')
      .replace(/^(?:>\s*)+/u, '')
      .replace(/^(?:[-*]\s*\[(?: |x|X)\]\s*)+/u, '')
      .replace(/^(?:\[(?: |x|X)\]\s*)+/u, '')
      .replace(LEADING_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN, '')
      .replace(LEADING_CJK_NUMBER_PAREN_MARKER_PATTERN, '')
      .replace(LEADING_FULLWIDTH_NUMBER_PAREN_MARKER_PATTERN, '')
      .replace(LEADING_FULLWIDTH_NUMBER_MARKER_PATTERN, '')
      .replace(LEADING_CIRCLED_NUMBER_MARKER_PATTERN, '')
      .replace(/^(?:(?:\(\d+\)|（\d+）|\([A-Za-z]\)|（[A-Za-z]）)\s*)+/u, '')
      .replace(LEADING_COMMON_ROMAN_OUTLINE_PAREN_MARKER_PATTERN, '')
      .replace(LEADING_COMMON_ROMAN_OUTLINE_MARKER_PATTERN, '')
      .replace(/^(?:(?:\d+[.)]|[A-Za-z][.)])\s*)+/u, '')
      .replace(/^(?:[-+*•・●→○◦▪◆■□▸▹►▻▶▷⁃‣–—―]\s*)+/u, '')
      .trim()
    if (next === stripped) {
      return stripped
    }
    stripped = next
  }
  return stripped
}

function stripTrailingPresentationListMarkers(text: string) {
  let stripped = text.trim()
  while (stripped) {
    let removed = false
    for (let index = stripped.length - 1; index >= 0; index -= 1) {
      const previousCharacter = stripped[index - 1]
      if (index > 0 && previousCharacter && !/[\s,;:([{]/u.test(previousCharacter)) {
        continue
      }

      const suffix = stripped.slice(index).trim()
      if (!suffix) {
        continue
      }
      if (stripLeadingPresentationListMarkers(suffix) !== '') {
        continue
      }

      stripped = stripped.slice(0, index).trimEnd()
      removed = true
      break
    }

    if (!removed) {
      return stripped
    }
  }

  return stripped
}

function stripStandalonePresentationListMarkerTokens(text: string) {
  return text
    .split(/\s+/)
    .filter((token) => token && !isStandalonePresentationListMarker(token))
    .join(' ')
}

function isStandalonePresentationListMarker(text: string) {
  const trimmed = text.trim()
  return (
    /^(?:#{1,6}|[-+*•・●→○◦▪◆■□▸▹►▻▶▷⁃‣–—―]|>+|\d+[.)]|[A-Za-z][.)]|\(\d+\)|（\d+）|\([A-Za-z]\)|（[A-Za-z]）|\[(?: |x|X)\])$/u.test(
      trimmed,
    ) ||
    STANDALONE_COMMON_ROMAN_OUTLINE_MARKER_PATTERN.test(trimmed) ||
    STANDALONE_FULLWIDTH_NUMBER_MARKER_PATTERN.test(trimmed) ||
    STANDALONE_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN.test(trimmed)
  )
}

function parseInlineTopicClause(clause: string): LabeledSourceResponseSection | undefined {
  const trimmed = stripLeadingPresentationListMarkers(
    clause.trim().replace(/^(?:and|but)\s+/i, ''),
  )
  if (!trimmed) {
    return undefined
  }
  if (extractPrefixedTopicSummary(trimmed)) {
    return undefined
  }

  const punctuated = /^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/.exec(trimmed)?.groups
  if (punctuated?.label && punctuated.answer) {
    return {
      label: punctuated.label.trim(),
      value: normalizeInlineTopicAnswer(punctuated.answer),
    }
  }

  const dashed = /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/.exec(trimmed)?.groups
  if (dashed?.label && dashed.answer) {
    return {
      label: dashed.label.trim(),
      value: normalizeInlineTopicAnswer(dashed.answer),
    }
  }

  if (
    isQuestionSourceResponseSentence(trimmed) ||
    startsWithNonPunctuatedWhClauseDeclarative(trimmed) ||
    resolveCanonicalQuestionAnchorMatch(
      trimmed,
      tokenizeEmbeddedMatchingRunSourceResponse(trimmed),
      0,
    )
  ) {
    return undefined
  }

  const verbal = new RegExp(
    `^(?<label>.+?)\\s+(?<answer>${TOPIC_SUMMARY_VERB_PATTERN}\\b.+)$`,
    'i',
  ).exec(trimmed)?.groups
  if (verbal?.label && verbal.answer && topicPredicateIncludesSubstantiveAnswerContent(verbal.answer)) {
    return {
      label: verbal.label.trim(),
      value: normalizeInlineTopicAnswer(verbal.answer),
    }
  }

  return undefined
}

function inlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause: string) {
  return (
    /^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/u.test(trimmedClause) ||
    /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/.test(trimmedClause)
  )
}

function inlineTopicClauseUsesNonLabeledSectionExplicitLabelValueSeparator(trimmedClause: string) {
  return (
    /^(?<label>.+?)\s*(?:=|＝|->|－>|→)\s*(?<answer>.+)$/u.test(trimmedClause) ||
    /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/.test(trimmedClause)
  )
}

function normalizeInlineTopicAnswer(value: string) {
  const stripped = normalizeExplicitTopicOrQuestionUnitText(value)
    .replace(/^(?:should|will|must|can|could|would|is|are|was|were)\b\s*/i, '')

  if (stripped.length === 0) {
    return stripped
  }

  return `${stripped.slice(0, 1).toUpperCase()}${stripped.slice(1)}`
}

function findMatchingTopicTextUnitIndexes(
  units: Array<{ normalizedText: string }>,
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
    normalizedCandidate: normalizeSourceResponseText(candidate),
    normalizedCandidateCore: normalizeQuestionPromptCore(candidate),
  }))
  const matchingIndexes = new Set<number>()

  for (const { normalizedCandidate, normalizedCandidateCore } of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }

    units.forEach((unit, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (
        topicTextMatchesCandidate(unit.normalizedText, normalizedCandidate, normalizedCandidateCore)
      ) {
        matchingIndexes.add(index)
      }
    })
  }

  return [...matchingIndexes].sort((left, right) => left - right)
}

function findMatchingTopicClauseIndexes(
  clauses: TopicSourceResponseSentence[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  return findMatchingTopicTextUnitIndexes(clauses, candidates, consumedIndexes)
}

function findMatchingTopicSentenceIndexes(
  sentences: TopicSourceResponseSentence[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  return findMatchingTopicTextUnitIndexes(sentences, candidates, consumedIndexes)
}

function findMatchingQuestionBlockIndexes(
  blocks: QuestionSourceResponseBlock[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
    normalizedCandidate: normalizeSourceResponseText(candidate),
    normalizedCandidateCore: normalizeQuestionPromptCore(candidate),
  }))
  const matchingIndexes = new Set<number>()

  for (const { normalizedCandidate, normalizedCandidateCore } of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }

    blocks.forEach((block, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (
        questionTextMatchesCandidate(
          block.normalizedQuestionText,
          block.normalizedQuestionCoreText,
          normalizedCandidate,
          normalizedCandidateCore,
        )
      ) {
        matchingIndexes.add(index)
      }
    })
  }

  return [...matchingIndexes].sort((left, right) => left - right)
}

function findMatchingQuestionSpanIndexes(
  spans: QuestionSourceResponseSpan[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
    normalizedCandidate: normalizeSourceResponseText(candidate),
    normalizedCandidateCore: normalizeQuestionPromptCore(candidate),
  }))
  const matchingIndexes = new Set<number>()

  for (const { normalizedCandidate, normalizedCandidateCore } of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }

    spans.forEach((span, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (
        questionTextMatchesCandidate(
          span.normalizedQuestionText,
          span.normalizedQuestionCoreText,
          normalizedCandidate,
          normalizedCandidateCore,
        )
      ) {
        matchingIndexes.add(index)
      }
    })
  }

  return [...matchingIndexes].sort((left, right) => left - right)
}

function findMatchingQuestionClosingSpanIndexes(
  spans: QuestionSourceResponseClosingSpan[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
    normalizedCandidate: normalizeSourceResponseText(candidate),
    normalizedCandidateCore: normalizeQuestionPromptCore(candidate),
  }))
  const matchingIndexes = new Set<number>()

  for (const { normalizedCandidate, normalizedCandidateCore } of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }

    spans.forEach((span, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (
        questionTextMatchesCandidate(
          span.normalizedQuestionText,
          span.normalizedQuestionCoreText,
          normalizedCandidate,
          normalizedCandidateCore,
        )
      ) {
        matchingIndexes.add(index)
      }
    })
  }

  return [...matchingIndexes].sort((left, right) => left - right)
}

function findMatchingQuestionClosingBlockIndexes(
  blocks: QuestionSourceResponseClosingBlock[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
    normalizedCandidate: normalizeSourceResponseText(candidate),
    normalizedCandidateCore: normalizeQuestionPromptCore(candidate),
  }))
  const matchingIndexes = new Set<number>()

  for (const { normalizedCandidate, normalizedCandidateCore } of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }

    blocks.forEach((block, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (
        questionTextMatchesCandidate(
          block.normalizedQuestionText,
          block.normalizedQuestionCoreText,
          normalizedCandidate,
          normalizedCandidateCore,
        )
      ) {
        matchingIndexes.add(index)
      }
    })
  }

  return [...matchingIndexes].sort((left, right) => left - right)
}

function findMatchingTopicParagraphIndexes(
  paragraphs: TopicSourceResponseParagraph[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  return findMatchingTopicTextUnitIndexes(paragraphs, candidates, consumedIndexes)
}

function findMatchingTopicSpanIndexes(
  spans: TopicSourceResponseSpan[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map(normalizeSourceResponseText)
  const matchingIndexes = new Set<number>()

  for (const normalizedCandidate of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }

    spans.forEach((span, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (span.normalizedAnchorLabel === normalizedCandidate) {
        matchingIndexes.add(index)
      }
    })
  }

  return [...matchingIndexes].sort((left, right) => left - right)
}

function findMatchingTopicClosingSpanIndexes(
  spans: TopicSourceResponseClosingSpan[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map(normalizeSourceResponseText)
  const matchingIndexes = new Set<number>()

  for (const normalizedCandidate of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }

    spans.forEach((span, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (span.normalizedClosingLabel === normalizedCandidate) {
        matchingIndexes.add(index)
      }
    })
  }

  return [...matchingIndexes].sort((left, right) => left - right)
}

function findMatchingTopicClosingBlockIndexes(
  blocks: TopicSourceResponseClosingBlock[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map(normalizeSourceResponseText)
  const matchingIndexes = new Set<number>()

  for (const normalizedCandidate of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }

    blocks.forEach((block, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (block.normalizedClosingLabel === normalizedCandidate) {
        matchingIndexes.add(index)
      }
    })
  }

  return [...matchingIndexes].sort((left, right) => left - right)
}

function findMatchingTopicBlockIndexes(
  blocks: TopicSourceResponseBlock[],
  candidates: string[],
  consumedIndexes: Set<number>,
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map(normalizeSourceResponseText)
  const matchingIndexes = new Set<number>()

  for (const normalizedCandidate of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }

    blocks.forEach((block, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (block.normalizedAnchorLabel === normalizedCandidate) {
        matchingIndexes.add(index)
      }
    })
  }

  return [...matchingIndexes].sort((left, right) => left - right)
}

function findMatchingNormalizedTopicLabels(
  normalizedText: string,
  normalizedCandidateLabels: Set<string>,
) {
  const matches: string[] = []
  for (const normalizedCandidate of normalizedCandidateLabels) {
    if (
      topicTextMatchesCandidate(
        normalizedText,
        normalizedCandidate,
        normalizeQuestionPromptCore(normalizedCandidate),
      )
    ) {
      matches.push(normalizedCandidate)
    }
  }
  return matches
}

function registerTopicAnchorCandidates(
  sourceResponseState: InterpretedSourceResponseState | undefined,
  candidateGroups: string[][],
) {
  if (
    !sourceResponseState ||
    (sourceResponseState.sourceResponseFormat !== 'topic_clauses' &&
      sourceResponseState.sourceResponseFormat !== 'topic_spans' &&
      sourceResponseState.sourceResponseFormat !== 'topic_middle_spans' &&
      sourceResponseState.sourceResponseFormat !== 'topic_closing_spans' &&
      sourceResponseState.sourceResponseFormat !== 'topic_closing_blocks' &&
      sourceResponseState.sourceResponseFormat !== 'topic_middle_blocks' &&
      sourceResponseState.sourceResponseFormat !== 'topic_blocks')
  ) {
    return
  }

  const candidateLabels = sourceResponseState.topicAnchorCandidateLabels ?? new Set<string>()
  let changed = false
  for (const candidateGroup of candidateGroups) {
    for (const candidate of dedupeNonEmptyStrings(candidateGroup)) {
      const normalizedCandidate = normalizeSourceResponseText(candidate)
      if (candidateLabels.has(normalizedCandidate)) {
        continue
      }
      candidateLabels.add(normalizedCandidate)
      changed = true
    }
  }

  sourceResponseState.topicAnchorCandidateLabels = candidateLabels
  if (changed) {
    sourceResponseState.topicClauses = undefined
    sourceResponseState.topicSpans = undefined
    sourceResponseState.topicMiddleSpans = undefined
    sourceResponseState.topicClosingSpans = undefined
    sourceResponseState.topicClosingBlocks = undefined
    sourceResponseState.topicMiddleBlocks = undefined
    sourceResponseState.topicBlocks = undefined
  }
}

function registerQuestionAnchorCandidateGroups(
  sourceResponseState: InterpretedSourceResponseState | undefined,
  candidateGroups: string[][],
) {
  if (
    !sourceResponseState ||
    (sourceResponseState.sourceResponseFormat !== 'question_spans' &&
      sourceResponseState.sourceResponseFormat !== 'question_middle_spans' &&
      sourceResponseState.sourceResponseFormat !== 'question_closing_spans')
  ) {
    return
  }

  const groups = sourceResponseState.questionAnchorCandidateGroups ?? []
  const lookup = sourceResponseState.questionAnchorCandidateLookup ?? new Map<string, number>()
  let changed = false

  for (const candidateGroup of candidateGroups) {
    const dedupedGroup = dedupeNonEmptyStrings(candidateGroup)
    if (dedupedGroup.length === 0) {
      continue
    }

    const groupKey = buildMatchingRunCandidateGroupKey(dedupedGroup)
    if (!groupKey || lookup.has(groupKey)) {
      continue
    }

    lookup.set(groupKey, groups.length)
    groups.push(dedupedGroup)
    changed = true
  }

  sourceResponseState.questionAnchorCandidateGroups = groups
  sourceResponseState.questionAnchorCandidateLookup = lookup
  if (changed) {
    sourceResponseState.questionSpans = undefined
    sourceResponseState.questionMiddleSpans = undefined
    sourceResponseState.questionClosingSpans = undefined
  }
}

function registerMatchingRunCandidateGroups(
  sourceResponseState: InterpretedSourceResponseState | undefined,
  candidateGroups: string[][],
) {
  if (
    !sourceResponseState ||
    (sourceResponseState.sourceResponseFormat !== 'matching_runs' &&
      sourceResponseState.sourceResponseFormat !== 'matching_opening_runs' &&
      sourceResponseState.sourceResponseFormat !== 'matching_closing_runs' &&
      sourceResponseState.sourceResponseFormat !== 'matching_middle_runs')
  ) {
    return
  }

  const groups = sourceResponseState.matchingRunCandidateGroups ?? []
  const lookup = sourceResponseState.matchingRunCandidateLookup ?? new Map<string, number>()
  let changed = false

  for (const candidateGroup of candidateGroups) {
    const dedupedGroup = dedupeNonEmptyStrings(candidateGroup)
    if (dedupedGroup.length === 0) {
      continue
    }

    const groupKey = buildMatchingRunCandidateGroupKey(dedupedGroup)
    if (!groupKey || lookup.has(groupKey)) {
      continue
    }

    lookup.set(groupKey, groups.length)
    groups.push(dedupedGroup)
    changed = true
  }

  sourceResponseState.matchingRunCandidateGroups = groups
  sourceResponseState.matchingRunCandidateLookup = lookup
  if (changed) {
    sourceResponseState.matchingRuns = undefined
    sourceResponseState.matchingOpeningRuns = undefined
    sourceResponseState.matchingClosingRuns = undefined
    sourceResponseState.matchingMiddleRuns = undefined
  }
}

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
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingQuestionBlockIndexes(blocks, candidates, reservedIndexes),
      `Multiple question blocks matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedQuestionSpan(
  spans: QuestionSourceResponseSpan[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingQuestionSpanIndexes(spans, candidates, reservedIndexes),
      `Multiple question spans matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedQuestionClosingSpan(
  spans: QuestionSourceResponseClosingSpan[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingQuestionClosingSpanIndexes(spans, candidates, reservedIndexes),
      `Multiple question closing spans matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedQuestionClosingBlock(
  blocks: QuestionSourceResponseClosingBlock[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingQuestionClosingBlockIndexes(blocks, candidates, reservedIndexes),
      `Multiple question closing blocks matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedTopicSentence(
  sentences: TopicSourceResponseSentence[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingTopicSentenceIndexes(sentences, candidates, reservedIndexes),
      `Multiple topic sentences matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedTopicClause(
  clauses: TopicSourceResponseSentence[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingTopicClauseIndexes(clauses, candidates, reservedIndexes),
      `Multiple topic clauses matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedTopicSpan(
  spans: TopicSourceResponseSpan[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingTopicSpanIndexes(spans, candidates, reservedIndexes),
      `Multiple topic spans matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedTopicClosingSpan(
  spans: TopicSourceResponseClosingSpan[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingTopicClosingSpanIndexes(spans, candidates, reservedIndexes),
      `Multiple topic closing spans matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedTopicClosingBlock(
  blocks: TopicSourceResponseClosingBlock[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingTopicClosingBlockIndexes(blocks, candidates, reservedIndexes),
      `Multiple topic closing blocks matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedTopicParagraph(
  paragraphs: TopicSourceResponseParagraph[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingTopicParagraphIndexes(paragraphs, candidates, reservedIndexes),
      `Multiple topic paragraphs matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function reserveMatchedTopicBlock(
  blocks: TopicSourceResponseBlock[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  markConsumedMatchingIndexes(
    reservedIndexes,
    resolveContiguousMatchingIndexes(
      findMatchingTopicBlockIndexes(blocks, candidates, reservedIndexes),
      `Multiple topic blocks matched reserved candidates ${candidates.join(', ')} in sourceResponse.`,
    ),
  )
}

function createKnownDecisionsBySummaryLookup(knownDecisions: InterpretableKnownDecision[]) {
  const lookup = new Map<string, InterpretableKnownDecision[]>()
  for (const decision of knownDecisions) {
    for (const candidate of [decision.summary, humanizeSummaryKey(decision.summaryKey)]) {
      if (!candidate) {
        continue
      }
      const normalized = normalizeSourceResponseLabel(candidate)
      if (!normalized) {
        continue
      }
      const existing = lookup.get(normalized)
      if (existing) {
        if (!existing.includes(decision)) {
          existing.push(decision)
        }
        continue
      }
      lookup.set(normalized, [decision])
    }
  }
  return lookup
}

function createKnownDecisionsByDecisionKeyLookup(knownDecisions: InterpretableKnownDecision[]) {
  const lookup = new Map<string, InterpretableKnownDecision>()
  for (const decision of knownDecisions) {
    const decisionKey = decision.decisionKey.trim()
    if (decisionKey) {
      lookup.set(decisionKey, decision)
    }
  }
  return lookup
}

function materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
  entries: ResolvedAnswerSourceEntry[],
  knownDecisions: InterpretableKnownDecision[],
  label: string,
  captureFormat?: AnswerCaptureFormat,
): MaterializedInterpretedDecisionAnswer[] {
  const knownDecisionsBySummary = createKnownDecisionsBySummaryLookup(knownDecisions)
  const knownDecisionsByDecisionKey = createKnownDecisionsByDecisionKeyLookup(knownDecisions)
  const answers = entries.map((entry) => {
    const summary = resolveRequiredAnswerSourceSummary(entry, label)
    const matchingKnownDecisionByKey = entry.decisionKey?.trim()
      ? knownDecisionsByDecisionKey.get(entry.decisionKey.trim())
      : undefined
    const matchingKnownDecisions = matchingKnownDecisionByKey
      ? [matchingKnownDecisionByKey]
      : (knownDecisionsBySummary.get(normalizeSourceResponseLabel(summary)) ?? [])
    if (matchingKnownDecisions.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple existing decisions match inferred answerSource summary "${summary}".`,
      )
    }

    const matchingKnownDecision = matchingKnownDecisions[0]
    const inferredSummaryKey = shouldDeriveSummaryKeyFromAnswerSourceKey(entry)
      ? inferSummaryKeyFromStableAnswerSourceKey(entry.key)
      : undefined
    return {
      summary: matchingKnownDecision?.summary ?? summary,
      ...(matchingKnownDecision?.summaryKey?.trim()
        ? { summaryKey: matchingKnownDecision.summaryKey.trim() }
        : entry.summaryKey?.trim()
          ? { summaryKey: entry.summaryKey.trim() }
          : inferredSummaryKey
            ? { summaryKey: inferredSummaryKey }
            : {}),
      ...(entry.prompt?.trim()
        ? { prompt: entry.prompt.trim() }
        : matchingKnownDecision
          ? {}
          : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
      ...(entry.matchHints?.length ? { matchHints: entry.matchHints } : {}),
      decisionKey: matchingKnownDecision?.decisionKey ?? entry.decisionKey?.trim(),
      taskRef: matchingKnownDecision?.taskRef,
      answer: entry.answer,
    }
  })
  return finalizeMaterializedDecisionAnswers(answers, captureFormat)
}

function findMatchingKnownDecisionsForQuestionBlock(
  block: QuestionSourceResponseBlock,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingQuestionBlockIndexes(
        [block],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForQuestionSpan(
  span: QuestionSourceResponseSpan,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingQuestionSpanIndexes(
        [span],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForQuestionClosingSpan(
  span: QuestionSourceResponseClosingSpan,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingQuestionClosingSpanIndexes(
        [span],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForQuestionClosingBlock(
  block: QuestionSourceResponseClosingBlock,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingQuestionClosingBlockIndexes(
        [block],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForTopicSentence(
  sentence: TopicSourceResponseSentence,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingTopicSentenceIndexes(
        [sentence],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForTopicClause(
  clause: TopicSourceResponseSentence,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingTopicClauseIndexes(
        [clause],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForTopicParagraph(
  paragraph: TopicSourceResponseParagraph,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingTopicParagraphIndexes(
        [paragraph],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForTopicSpan(
  span: TopicSourceResponseSpan,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingTopicSpanIndexes(
        [span],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForTopicClosingSpan(
  span: TopicSourceResponseClosingSpan,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingTopicClosingSpanIndexes(
        [span],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForTopicClosingBlock(
  block: TopicSourceResponseClosingBlock,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingTopicClosingBlockIndexes(
        [block],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function findMatchingKnownDecisionsForTopicBlock(
  block: TopicSourceResponseBlock,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingTopicBlockIndexes(
        [block],
        buildKnownDecisionSourceResponseCandidates(decision),
        new Set<number>(),
      ).length > 0,
  )
}

function stripQuestionBlockLabel(question: string) {
  return stripLeadingQuestionPromptConjunction(question)
    .replace(/[?？]+\s*$/u, '')
    .trim()
}

function inferSummaryFromQuestionLabel(question: string) {
  return inferCanonicalQuestionAnchorSummary(question) ?? stripQuestionBlockLabel(question)
}

function inferComparableQuestionTopicSummary(question: string) {
  return (
    inferCanonicalQuestionAnchorSummary(question) ??
    normalizeExtractedTopicSummary(stripQuestionBlockLabel(question), true)
  )
}

function inferComparableExplicitLabelSummary(label: string) {
  return inferCanonicalQuestionAnchorSummary(label) ?? normalizeExtractedTopicSummary(label, true)
}

const SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES = [
  ['any', 'time'],
  ['as', 'far', 'as'],
  ['as', 'long', 'as'],
  ['as', 'much', 'as'],
  ['as', 'soon', 'as'],
  ['as', 'if'],
  ['as', 'though'],
  ['again', 'and', 'again'],
  ['all', 'along'],
  ['all', 'at', 'once'],
  ['all', 'of', 'a', 'sudden'],
  ['all', 'the', 'while'],
  ['all', 'this', 'time'],
  ['all', 'too', 'often'],
  ['at', 'another', 'point'],
  ['at', 'an', 'early', 'stage'],
  ['at', 'first'],
  ['at', 'intervals'],
  ['at', 'irregular', 'intervals'],
  ['at', 'last'],
  ['at', 'length'],
  ['at', 'present'],
  ['at', 'regular', 'intervals'],
  ['at', 'some', 'stage'],
  ['at', 'that', 'point'],
  ['at', 'that', 'stage'],
  ['at', 'the', 'outset'],
  ['at', 'this', 'point'],
  ['at', 'this', 'stage'],
  ['even', 'as'],
  ['even', 'if'],
  ['even', 'when'],
  ['even', 'though'],
  ['except', 'if'],
  ['except', 'when'],
  ['at', 'one', 'point'],
  ['at', 'some', 'point'],
  ['at', 'times'],
  ['by', 'the', 'time'],
  ['each', 'time'],
  ['every', 'time'],
  ['every', 'now', 'and', 'again'],
  ['every', 'now', 'and', 'then'],
  ['every', 'blue', 'moon'],
  ['every', 'once', 'in', 'a', 'while'],
  ['every', 'so', 'often'],
  ['fear', 'that'],
  ['fifth', 'time'],
  ['first', 'time'],
  ['fourth', 'time'],
  ['for', 'fear', 'that'],
  ['for', 'a', 'while'],
  ['for', 'the', 'foreseeable', 'future'],
  ['for', 'the', 'near', 'future'],
  ['for', 'now'],
  ['for', 'quite', 'a', 'while'],
  ['for', 'the', 'time', 'being'],
  ['from', 'time', 'immemorial'],
  ['from', 'time', 'to', 'time'],
  ['given', 'that'],
  ['independent', 'of', 'whether'],
  ['in', 'case'],
  ['in', 'due', 'course'],
  ['in', 'the', 'meantime'],
  ['inasmuch', 'as'],
  ['in', 'order', 'to'],
  ['insofar', 'as'],
  ['irrespective', 'of', 'whether'],
  ['just', 'as'],
  ['last', 'time'],
  ['now', 'and', 'again'],
  ['now', 'and', 'then'],
  ['next', 'time'],
  ['not', 'infrequently'],
  ['second', 'time'],
  ['third', 'time'],
  ['the', 'first', 'time'],
  ['the', 'fifth', 'time'],
  ['the', 'fourth', 'time'],
  ['the', 'instant'],
  ['the', 'last', 'time'],
  ['the', 'minute'],
  ['the', 'moment'],
  ['the', 'next', 'time'],
  ['the', 'ninth', 'time'],
  ['the', 'second', 'time'],
  ['the', 'seventh', 'time'],
  ['the', 'sixth', 'time'],
  ['the', 'tenth', 'time'],
  ['the', 'third', 'time'],
  ['the', 'eighth', 'time'],
  ['now', 'that'],
  ['no', 'matter', 'how'],
  ['no', 'matter', 'if'],
  ['no', 'matter', 'when'],
  ['no', 'matter', 'whether'],
  ['once', 'again'],
  ['once', 'in', 'a', 'blue', 'moon'],
  ['only', 'if'],
  ['only', 'when'],
  ['off', 'and', 'on'],
  ['on', 'and', 'off'],
  ['on', 'a', 'daily', 'basis'],
  ['on', 'a', 'monthly', 'basis'],
  ['on', 'a', 'regular', 'basis'],
  ['on', 'a', 'weekly', 'basis'],
  ['on', 'a', 'yearly', 'basis'],
  ['on', 'an', 'irregular', 'basis'],
  ['on', 'occasion'],
  ['on', 'rare', 'occasions'],
  ['on', 'short', 'notice'],
  ['once', 'in', 'a', 'while'],
  ['over', 'and', 'over'],
  ['over', 'and', 'over', 'again'],
  ['provided', 'that'],
  ['regardless', 'of', 'whether'],
  ['save', 'that'],
  ['seeing', 'that'],
  ['so', 'long', 'as'],
  ['so', 'far', 'as'],
  ['so', 'often'],
  ['so', 'that'],
  ['sooner', 'or', 'later'],
  ['supposing', 'that'],
  ['more', 'often', 'than', 'not'],
  ['time', 'after', 'time'],
  ['time', 'and', 'again'],
  ['time', 'and', 'time', 'again'],
  ['to', 'date'],
  ['to', 'this', 'day'],
  ['until', 'then'],
  ['after', 'a', 'while'],
  ['after', 'a', 'time'],
  ['after', 'some', 'time'],
  ['after'],
  ['afterward'],
  ['afterwards'],
  ['accordingly'],
  ['admittedly'],
  ['although'],
  ['alternatively'],
  ['another', 'time'],
  ['apparently'],
  ['arguably'],
  ['assuming'],
  ['at', 'irregular', 'times'],
  ['at', 'regular', 'times'],
  ['at', 'short', 'notice'],
  ['back', 'and', 'forth'],
  ['before', 'too', 'long'],
  ['because'],
  ['before', 'long'],
  ['before'],
  ['beforehand'],
  ['basically'],
  ['by', 'then'],
  ['broadly'],
  ['certainly'],
  ['chiefly'],
  ['conceivably'],
  ['concurrently'],
  ['collectively'],
  ['consequently'],
  ['crucially'],
  ['conventionally'],
  ['conversely'],
  ['currently'],
  ['day', 'after', 'day'],
  ['day', 'by', 'day'],
  ['decidedly'],
  ['definitely'],
  ['earlier'],
  ['effectively'],
  ['essentially'],
  ['evidently'],
  ['ever', 'since'],
  ['finally'],
  ['formally'],
  ['for', 'a', 'time'],
  ['for', 'the', 'first', 'little', 'while'],
  ['for', 'the', 'next', 'little', 'while'],
  ['formerly'],
  ['granted'],
  ['for', 'some', 'time'],
  ['from', 'day', 'one'],
  ['from', 'now', 'on'],
  ['from', 'the', 'beginning'],
  ['from', 'the', 'outset'],
  ['from', 'that', 'point', 'on'],
  ['from', 'then', 'on'],
  ['from', 'this', 'point', 'on'],
  ['fundamentally'],
  ['given'],
  ['gradually'],
  ['generally'],
  ['hence'],
  ['henceforth'],
  ['henceforward'],
  ['hereafter'],
  ['hereby'],
  ['hereupon'],
  ['historically'],
  ['if'],
  ['ideally'],
  ['immediately'],
  ['implicitly'],
  ['importantly'],
  ['incidentally'],
  ['individually'],
  ['initially'],
  ['informally'],
  ['instantly'],
  ['instead'],
  ['inevitably'],
  ['lately'],
  ['lest'],
  ['later'],
  ['largely'],
  ['in', 'the', 'early', 'stages'],
  ['loosely'],
  ['in', 'no', 'time'],
  ['in', 'the', 'foreseeable', 'future'],
  ['in', 'the', 'fullness', 'of', 'time'],
  ['in', 'the', 'later', 'stages'],
  ['in', 'short', 'order'],
  ['in', 'the', 'beginning'],
  ['in', 'the', 'end'],
  ['in', 'the', 'long', 'run'],
  ['in', 'the', 'long', 'term'],
  ['in', 'the', 'medium', 'term'],
  ['in', 'the', 'near', 'term'],
  ['in', 'the', 'near', 'future'],
  ['in', 'the', 'short', 'run'],
  ['in', 'the', 'short', 'term'],
  ['in', 'time'],
  ['instant'],
  ['little', 'by', 'little'],
  ['meanwhile'],
  ['mainly'],
  ['manifestly'],
  ['merely'],
  ['minute'],
  ['moment'],
  ['momentarily'],
  ['month', 'after', 'month'],
  ['naturally'],
  ['ninth', 'time'],
  ['night', 'after', 'night'],
  ['normally'],
  ['nowadays'],
  ['notably'],
  ['occasionally'],
  ['officially'],
  ['ordinarily'],
  ['ostensibly'],
  ['otherwise'],
  ['over', 'time'],
  ['nominally'],
  ['narrowly'],
  ['partially'],
  ['partly'],
  ['permanently'],
  ['possibly'],
  ['practically'],
  ['predominantly'],
  ['provided'],
  ['presently'],
  ['previously'],
  ['primarily'],
  ['promptly'],
  ['provisionally'],
  ['potentially'],
  ['presumably'],
  ['principally'],
  ['approximately'],
  ['save'],
  ['realistically'],
  ['regularly'],
  ['recently'],
  ['remarkably'],
  ['roughly'],
  ['seemingly'],
  ['simply'],
  ['similarly'],
  ['simultaneously'],
  ['seventh', 'time'],
  ['seeing'],
  ['since', 'then'],
  ['since'],
  ['sixth', 'time'],
  ['soon'],
  ['shortly'],
  ['sometimes'],
  ['specifically'],
  ['step', 'by', 'step'],
  ['strictly'],
  ['subsequently'],
  ['supposing'],
  ['surely'],
  ['tentatively'],
  ['thereafter'],
  ['thereupon'],
  ['that', 'time'],
  ['tenth', 'time'],
  ['temporarily'],
  ['this', 'time'],
  ['theoretically'],
  ['technically'],
  ['though'],
  ['traditionally'],
  ['typically'],
  ['thereby'],
  ['therefore'],
  ['ultimately'],
  ['undoubtedly'],
  ['usually'],
  ['thus'],
  ['virtually'],
  ['eventually'],
  ['explicitly'],
  ['academically'],
  ['aesthetically'],
  ['administratively'],
  ['allegedly'],
  ['algorithmically'],
  ['analytically'],
  ['alarmingly'],
  ['amazingly'],
  ['abstractly'],
  ['architecturally'],
  ['astonishingly'],
  ['automatically'],
  ['abruptly'],
  ['biologically'],
  ['bizarrely'],
  ['briefly'],
  ['carefully'],
  ['canonically'],
  ['clearly'],
  ['civically'],
  ['chronologically'],
  ['clinically'],
  ['commonly'],
  ['commercially'],
  ['comparatively'],
  ['computationally'],
  ['concretely'],
  ['coincidentally'],
  ['conceptually'],
  ['conveniently'],
  ['confidentially'],
  ['constitutionally'],
  ['contextually'],
  ['counterintuitively'],
  ['contractually'],
  ['critically'],
  ['curiously'],
  ['cynically'],
  ['demographically'],
  ['descriptively'],
  ['diagnostically'],
  ['domestically'],
  ['dramatically'],
  ['culturally'],
  ['delicately'],
  ['deliberately'],
  ['directly'],
  ['ecologically'],
  ['economically'],
  ['empirically'],
  ['ethically'],
  ['environmentally'],
  ['exactly'],
  ['expectedly'],
  ['experimentally'],
  ['externally'],
  ['financially'],
  ['figuratively'],
  ['famously'],
  ['fortunately'],
  ['frankly'],
  ['frequently'],
  ['functionally'],
  ['geographically'],
  ['geologically'],
  ['globally'],
  ['grammatically'],
  ['happily'],
  ['hermeneutically'],
  ['honestly'],
  ['iconically'],
  ['ideologically'],
  ['indirectly'],
  ['industrially'],
  ['institutionally'],
  ['incredibly'],
  ['inexplicably'],
  ['internationally'],
  ['internally'],
  ['interestingly'],
  ['intentionally'],
  ['intuitively'],
  ['ironically'],
  ['juridically'],
  ['judicially'],
  ['legally'],
  ['likewise'],
  ['literally'],
  ['literarily'],
  ['linguistically'],
  ['locally'],
  ['logistically'],
  ['loudly'],
  ['managerially'],
  ['mathematically'],
  ['mechanically'],
  ['mechanistically'],
  ['maybe'],
  ['mercifully'],
  ['medically'],
  ['metaphorically'],
  ['methodologically'],
  ['musically'],
  ['mysteriously'],
  ['narratively'],
  ['notionally'],
  ['notoriously'],
  ['normatively'],
  ['numerically'],
  ['objectively'],
  ['oddly'],
  ['openly'],
  ['operationally'],
  ['organizationally'],
  ['perhaps'],
  ['paradoxically'],
  ['pedagogically'],
  ['personally'],
  ['philosophically'],
  ['physically'],
  ['plainly'],
  ['politely'],
  ['pragmatically'],
  ['prescriptively'],
  ['precisely'],
  ['puzzlingly'],
  ['probabilistically'],
  ['originally'],
  ['predictably'],
  ['privately'],
  ['politically'],
  ['procedurally'],
  ['professionally'],
  ['psychologically'],
  ['publicly'],
  ['purposely'],
  ['quietly'],
  ['qualitatively'],
  ['quantitatively'],
  ['rarely'],
  ['readily'],
  ['regionally'],
  ['regrettably'],
  ['reportedly'],
  ['respectfully'],
  ['rhetorically'],
  ['routinely'],
  ['sadly'],
  ['scientifically'],
  ['secretly'],
  ['semantically'],
  ['seriously'],
  ['shockingly'],
  ['socially'],
  ['sociologically'],
  ['speculatively'],
  ['surprisingly'],
  ['statistically'],
  ['stylistically'],
  ['structurally'],
  ['strategically'],
  ['strangely'],
  ['supposedly'],
  ['suddenly'],
  ['swiftly'],
  ['sympathetically'],
  ['symbolically'],
  ['systematically'],
  ['sharply'],
  ['slowly'],
  ['tactically'],
  ['technologically'],
  ['thankfully'],
  ['thematically'],
  ['textually'],
  ['topologically'],
  ['tragically'],
  ['typologically'],
  ['unexpectedly'],
  ['unfortunately'],
  ['understandably'],
  ['unbelievably'],
  ['unsurprisingly'],
  ['unusually'],
  ['verbally'],
  ['viscerally'],
  ['visibly'],
  ['visually'],
  ['wonderfully'],
  ['week', 'after', 'week'],
  ['with', 'time'],
  ['until'],
  ['unless'],
  ['eighth', 'time'],
  ['whenever'],
  ['whether', 'or', 'not'],
  ['whether'],
  ['whereas'],
  ['wherever'],
  ['while'],
  ['wisely'],
  ['customarily'],
  ['morally'],
  ['year', 'after', 'year'],
] as const

const SUBORDINATE_CLAUSE_LEADING_WORDS = new Set(
  [
    ...SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES.flatMap((sequence) =>
      sequence.length === 1 ? [sequence[0]] : [],
    ),
    'once',
    'twice',
    'thrice',
  ],
)

const MULTI_TOKEN_SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES =
  SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES.filter((sequence) => sequence.length > 1)

const SUBORDINATE_CLAUSE_ORDINAL_TIME_SINGLE_TOKEN_ORDINALS = new Set([
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
  'fourteenth',
  'fifteenth',
  'sixteenth',
  'seventeenth',
  'eighteenth',
  'nineteenth',
  'twentieth',
  'thirtieth',
  'fortieth',
  'fiftieth',
  'sixtieth',
  'seventieth',
  'eightieth',
  'ninetieth',
  'hundredth',
])

const SUBORDINATE_CLAUSE_ORDINAL_TIME_TENS_TOKENS = new Set([
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
])

const SUBORDINATE_CLAUSE_ORDINAL_TIME_COMPOUND_TAIL_TOKENS = new Set([
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
])

const SUBORDINATE_CLAUSE_TIME_LEADING_SIMPLE_HEAD_TOKENS = new Set([
  'another',
  'any',
  'each',
  'every',
  'last',
  'many',
  'most',
  'next',
  'one',
  'only',
  'other',
  'same',
  'several',
  'some',
  'that',
  'this',
])

const SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_PREFIX_TOKENS = new Set(['very', 'yet'])

const SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_MIDDLE_TOKENS = new Set([
  'couple',
  'every',
  'few',
  'more',
  'other',
  'several',
  'single',
])

const SUBORDINATE_CLAUSE_TIME_PLURAL_QUANTITY_TOKENS = new Set([
  'couple',
  'few',
  'several',
])

const SUBORDINATE_CLAUSE_TIME_DIRECT_TIMES_COUNT_HEAD_TOKENS = new Set([
  'countless',
  'half',
  'multiple',
  'numerous',
])

const SUBORDINATE_CLAUSE_TIME_LEXICAL_COUNT_HEAD_TOKENS = new Set(['once', 'twice', 'thrice'])

const SUBORDINATE_CLAUSE_TIME_COUNT_NOUN_LEADING_QUANTIFIER_TOKENS = new Set([
  'few',
  'many',
  'several',
])

const SUBORDINATE_CLAUSE_TIME_SINGLE_TOKEN_CARDINAL_TOKENS = new Set([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
])

const SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TENS_TOKENS = new Set([
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
])

const SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TAIL_TOKENS = new Set([
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
])

const SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS = new Set([
  'score',
  'dozen',
  'hundred',
  'thousand',
])

const SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS = new Set([
  'scores',
  'dozens',
  'hundreds',
  'thousands',
])

const SUBORDINATE_CLAUSE_TIME_DIRECT_THE_TIME_HEAD_TOKENS = new Set(['all', 'half'])

const SUBORDINATE_CLAUSE_TIME_OF_THE_TIME_HEAD_TOKENS = new Set([
  'all',
  'half',
  'most',
  'much',
  'part',
  'rest',
  'some',
])

const SUBORDINATE_CLAUSE_TIME_OF_TIMES_HEAD_TOKENS = new Set(['plenty'])

const SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_MODIFIER_TOKENS = new Set([
  'awful',
  'fair',
  'good',
  'great',
  'half',
  'huge',
  'large',
  'small',
  'tiny',
  'very',
  'whole',
])

const SUBORDINATE_CLAUSE_TIME_PRE_ARTICLE_PREFIX_TOKENS = new Set([
  'just',
  'only',
  'quite',
])

const SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS = new Set([
  'couple',
  'few',
  'many',
])

const SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS = new Set([
  'couple',
  'few',
])

const SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS = new Set([
  'more',
])

const SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS = new Set([
  'more',
  'so',
])

const SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OF_TIMES_HEAD_TOKENS = new Set([
  'bunch',
  'couple',
  'handful',
  'lot',
  'number',
])

const SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS = new Set([
  'bunch',
  'couple',
  'handful',
  'lot',
  'number',
])

const SUBORDINATE_CLAUSE_PREPOSITIONAL_TIME_LEADING_TOKENS = new Set([
  'at',
  'by',
  'for',
  'from',
])

const SUBORDINATE_CLAUSE_PREPOSITIONAL_TIME_POINT_HEAD_TOKENS = new Set([
  'instant',
  'minute',
  'moment',
])

const SUBORDINATE_CLAUSE_TIME_DURATION_UNIT_TOKENS = new Set([
  'ages',
  'centuries',
  'days',
  'decades',
  'months',
  'weeks',
  'years',
])

const SUBORDINATE_CLAUSE_TIME_DURATION_HORIZON_MODIFIER_TOKENS = new Set([
  'long',
  'medium',
  'short',
])

function matchLeadingTokenSequenceLength(
  tokens: string[],
  sequences: readonly (readonly string[])[],
) {
  let bestMatchLength: number | undefined

  for (const sequence of sequences) {
    if (sequence.length > tokens.length) {
      continue
    }

    let matches = true
    for (let index = 0; index < sequence.length; index += 1) {
      if (tokens[index] !== sequence[index]) {
        matches = false
        break
      }
    }

    if (matches) {
      bestMatchLength = Math.max(bestMatchLength ?? 0, sequence.length)
    }
  }

  return bestMatchLength
}

function sourceResponseStartsWithProtectedLeadingConjunctionSequence(sourceResponse: string) {
  const normalizedLabel = normalizeSourceResponseLabel(sourceResponse)
  if (!normalizedLabel) {
    return false
  }

  const tokens = normalizedLabel.split(' ').filter(Boolean)
  const leadingSequenceLength = matchLeadingSubordinateClauseSequenceLength(tokens)
  if (leadingSequenceLength === undefined) {
    return false
  }

  const leadingTokens = tokens.slice(0, leadingSequenceLength)
  return leadingTokens.includes('and') || leadingTokens.includes('then')
}

function matchGenericTimeSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  let tokenIndex = startIndex

  while (
    tokenIndex < tokens.length &&
    SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_PREFIX_TOKENS.has(tokens[tokenIndex] ?? '')
  ) {
    tokenIndex += 1
  }

  if (tokenIndex >= tokens.length) {
    return undefined
  }

  const simpleHeadToken = tokens[tokenIndex]
  if (
    simpleHeadToken &&
    SUBORDINATE_CLAUSE_TIME_LEADING_SIMPLE_HEAD_TOKENS.has(simpleHeadToken)
  ) {
    let nounIndex = tokenIndex + 1

    while (
      nounIndex < tokens.length &&
      SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_MIDDLE_TOKENS.has(tokens[nounIndex] ?? '')
    ) {
      nounIndex += 1
    }

    const nounToken = tokens[nounIndex]
    const previousToken = tokens[nounIndex - 1]
    if (nounToken === 'time') {
      if (simpleHeadToken === 'some') {
        return previousToken === 'other' || previousToken === 'some'
          ? nounIndex - startIndex + 1
          : undefined
      }

      if (simpleHeadToken === 'most') {
        return previousToken === 'every' ? nounIndex - startIndex + 1 : undefined
      }

      return nounIndex - startIndex + 1
    }

    if (
      nounToken === 'times' &&
      (simpleHeadToken === 'many' ||
        simpleHeadToken === 'most' ||
        simpleHeadToken === 'several' ||
        simpleHeadToken === 'some' ||
        SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_MIDDLE_TOKENS.has(
          tokens[nounIndex - 1] ?? '',
        ))
    ) {
      return nounIndex - startIndex + 1
    }

    if (
      nounToken === 'of' &&
      previousToken &&
      SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS.has(previousToken) &&
      tokens[nounIndex + 1] === 'times'
    ) {
      return nounIndex - startIndex + 2
    }

    if (
      nounToken &&
      SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS.has(nounToken) &&
      tokens[nounIndex + 1] === 'of' &&
      tokens[nounIndex + 2] === 'times'
    ) {
      return nounIndex - startIndex + 3
    }
  }

  const ordinalTimeSequenceLength = matchOrdinalTimeSubordinateClauseSequenceLengthAt(
    tokens,
    tokenIndex,
  )
  if (ordinalTimeSequenceLength !== undefined) {
    return tokenIndex - startIndex + ordinalTimeSequenceLength
  }

  const quantifiedTimeSequenceLength = matchQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
    tokens,
    tokenIndex,
  )
  if (quantifiedTimeSequenceLength !== undefined) {
    return tokenIndex - startIndex + quantifiedTimeSequenceLength
  }

  return undefined
}

function matchDurationUnitTemporalPhraseSequenceLengthAt(tokens: string[], startIndex: number) {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]
  const thirdToken = tokens[startIndex + 2]
  const fourthToken = tokens[startIndex + 3]

  if (
    firstToken === 'for' &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_DURATION_UNIT_TOKENS.has(secondToken)
  ) {
    return 2
  }

  if (
    firstToken === 'over' &&
    secondToken === 'the' &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_DURATION_UNIT_TOKENS.has(thirdToken)
  ) {
    return 3
  }

  if (
    firstToken === 'over' &&
    secondToken === 'the' &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_DURATION_HORIZON_MODIFIER_TOKENS.has(thirdToken) &&
    fourthToken === 'term'
  ) {
    return 4
  }

  if (
    firstToken === 'in' &&
    secondToken === 'recent' &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_DURATION_UNIT_TOKENS.has(thirdToken)
  ) {
    return 3
  }

  return undefined
}

function isOrdinalTimeLeadingToken(token: string | undefined) {
  return Boolean(
    token &&
      (SUBORDINATE_CLAUSE_ORDINAL_TIME_SINGLE_TOKEN_ORDINALS.has(token) ||
        /^\d+(?:st|nd|rd|th)$/i.test(token)),
  )
}

function matchOrdinalTimeSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]
  const thirdToken = tokens[startIndex + 2]
  const fourthToken = tokens[startIndex + 3]
  const fifthToken = tokens[startIndex + 4]

  if (isOrdinalTimeLeadingToken(firstToken)) {
    if (secondToken === 'time') {
      return 2
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_PLURAL_QUANTITY_TOKENS.has(secondToken) &&
      thirdToken === 'times'
    ) {
      return 3
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS.has(secondToken) &&
      thirdToken === 'of' &&
      fourthToken === 'times'
    ) {
      return 4
    }
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_ORDINAL_TIME_TENS_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_ORDINAL_TIME_COMPOUND_TAIL_TOKENS.has(secondToken)
  ) {
    if (thirdToken === 'time') {
      return 3
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_PLURAL_QUANTITY_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS.has(thirdToken) &&
      fourthToken === 'of' &&
      fifthToken === 'times'
    ) {
      return 5
    }
  }

  return undefined
}

function isSingleTokenCardinalTimeLeadingToken(token: string | undefined) {
  return Boolean(
    token &&
      (SUBORDINATE_CLAUSE_TIME_SINGLE_TOKEN_CARDINAL_TOKENS.has(token) || /^\d+$/.test(token)),
  )
}

function matchTimeCardinalSequenceLengthAt(tokens: string[], startIndex: number): number | undefined {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TENS_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TAIL_TOKENS.has(secondToken)
  ) {
    return 2
  }

  return isSingleTokenCardinalTimeLeadingToken(firstToken) ? 1 : undefined
}

function getTimeLexicalCountOrder(token: string | undefined) {
  switch (token) {
    case 'once':
      return 1
    case 'twice':
      return 2
    case 'thrice':
      return 3
    default:
      return undefined
  }
}

function matchTimeCardinalRangeSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstCardinalLength = matchTimeCardinalSequenceLengthAt(tokens, startIndex)
  if (firstCardinalLength === undefined || tokens[startIndex + firstCardinalLength] !== 'or') {
    return undefined
  }

  const secondCardinalStartIndex = startIndex + firstCardinalLength + 1
  const secondCardinalLength = matchTimeCardinalSequenceLengthAt(tokens, secondCardinalStartIndex)
  if (secondCardinalLength === undefined) {
    return undefined
  }

  const afterSecondCardinalIndex = secondCardinalStartIndex + secondCardinalLength
  const afterSecondCardinalToken = tokens[afterSecondCardinalIndex]
  const followingToken = tokens[afterSecondCardinalIndex + 1]
  const trailingToken = tokens[afterSecondCardinalIndex + 2]

  if (afterSecondCardinalToken === 'times') {
    return afterSecondCardinalIndex - startIndex + 1
  }

  if (
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
      afterSecondCardinalToken ?? '',
    ) &&
    followingToken === 'times'
  ) {
    return afterSecondCardinalIndex - startIndex + 2
  }

  if (
    afterSecondCardinalToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(afterSecondCardinalToken)
  ) {
    if (followingToken === 'times') {
      return afterSecondCardinalIndex - startIndex + 2
    }

    if (
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(followingToken ?? '') &&
      trailingToken === 'times'
    ) {
      return afterSecondCardinalIndex - startIndex + 3
    }
  }

  return undefined
}

function matchCountBasedTimeSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]
  const thirdToken = tokens[startIndex + 2]
  const fourthToken = tokens[startIndex + 3]
  const fifthToken = tokens[startIndex + 4]
  const sixthToken = tokens[startIndex + 5]

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_DIRECT_TIMES_COUNT_HEAD_TOKENS.has(firstToken) &&
    secondToken === 'times'
  ) {
    return 2
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_DIRECT_TIMES_COUNT_HEAD_TOKENS.has(firstToken) &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(secondToken ?? '') &&
    thirdToken === 'times'
  ) {
    return 3
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_LEXICAL_COUNT_HEAD_TOKENS.has(firstToken)
  ) {
    if (secondToken === 'more') {
      return 2
    }

    if (
      secondToken === 'or' &&
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_LEXICAL_COUNT_HEAD_TOKENS.has(thirdToken) &&
      getTimeLexicalCountOrder(thirdToken) === getTimeLexicalCountOrder(firstToken)! + 1
    ) {
      if (fourthToken === 'more') {
        return 4
      }

      return 3
    }

    return 1
  }

  const cardinalRangeSequenceLength = matchTimeCardinalRangeSequenceLengthAt(tokens, startIndex)
  if (cardinalRangeSequenceLength !== undefined) {
    return cardinalRangeSequenceLength
  }

  if (isSingleTokenCardinalTimeLeadingToken(firstToken)) {
    if (secondToken === 'times') {
      return 2
    }

    if (
      secondToken === 'or' &&
      isSingleTokenCardinalTimeLeadingToken(thirdToken) &&
      ((fourthToken === 'times' ||
        (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '') &&
          fifthToken === 'times')) ||
        (fourthToken &&
          SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(fourthToken) &&
          (fifthToken === 'times' ||
            (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
              fifthToken ?? '',
            ) &&
              sixthToken === 'times'))))
    ) {
      if (fourthToken === 'times') {
        return 4
      }

      if (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '')) {
        return 5
      }

      return fifthToken === 'times' ? 5 : 6
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(secondToken) &&
      thirdToken === 'times'
    ) {
      return 3
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(secondToken) &&
      thirdToken === 'times'
    ) {
      return 3
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(secondToken) &&
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TENS_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TAIL_TOKENS.has(secondToken)
  ) {
    if (thirdToken === 'times') {
      return 3
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(thirdToken) &&
      fourthToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken) &&
      fifthToken === 'times'
    ) {
      return 5
    }
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_COUNT_NOUN_LEADING_QUANTIFIER_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(secondToken)
  ) {
    if (thirdToken === 'times') {
      return 3
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }

    if (
      thirdToken === 'and' &&
      fourthToken === 'a' &&
      fifthToken === 'half' &&
      (sixthToken === 'times' ||
        (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
          sixthToken ?? '',
        ) &&
          tokens[startIndex + 6] === 'times'))
    ) {
      return sixthToken === 'times' ? 6 : 7
    }

    if (thirdToken === 'or') {
      if (
        fourthToken === 'so' &&
        (fifthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
            fifthToken ?? '',
          ) &&
            sixthToken === 'times'))
      ) {
        return fifthToken === 'times' ? 5 : 6
      }

      if (fourthToken === 'more' && fifthToken === 'times') {
        return 5
      }

      const cardinalLength = matchTimeCardinalSequenceLengthAt(tokens, startIndex + 3)
      if (cardinalLength !== undefined) {
        const afterCardinalIndex = startIndex + 3 + cardinalLength
        if (tokens[afterCardinalIndex] === 'times') {
          return afterCardinalIndex - startIndex + 1
        }

        if (
          SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
            tokens[afterCardinalIndex] ?? '',
          ) &&
          tokens[afterCardinalIndex + 1] === 'times'
        ) {
          return afterCardinalIndex - startIndex + 2
        }
      }
    }
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS.has(firstToken) &&
    secondToken === 'of' &&
    thirdToken === 'times'
  ) {
    return 3
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(secondToken) &&
    thirdToken === 'times'
  ) {
    return 3
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS.has(firstToken) &&
    secondToken === 'or' &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(thirdToken) &&
    (fourthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '') &&
        fifthToken === 'times'))
  ) {
    return fourthToken === 'times' ? 4 : 5
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS.has(firstToken) &&
    secondToken === 'and' &&
    thirdToken === firstToken &&
    ((fourthToken === 'of' && fifthToken === 'times') ||
      (fourthToken &&
        SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken) &&
        fifthToken === 'times') ||
      (fourthToken === 'or' &&
        fifthToken &&
        SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(fifthToken) &&
        (sixthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
            sixthToken ?? '',
          ) &&
            tokens[startIndex + 6] === 'times'))))
  ) {
    if (fourthToken !== 'or') {
      return 5
    }

    return sixthToken === 'times' ? 6 : 7
  }

  return undefined
}

function matchQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]
  const thirdToken = tokens[startIndex + 2]
  const fourthToken = tokens[startIndex + 3]
  const fifthToken = tokens[startIndex + 4]

  if (
    firstToken === 'half' &&
    (secondToken === 'a' || secondToken === 'an') &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(thirdToken) &&
    (fourthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '') &&
        fifthToken === 'times'))
  ) {
    return fourthToken === 'times' ? 4 : 5
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_DIRECT_THE_TIME_HEAD_TOKENS.has(firstToken) &&
    secondToken === 'the' &&
    thirdToken === 'time'
  ) {
    return 3
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_OF_THE_TIME_HEAD_TOKENS.has(firstToken) &&
    secondToken === 'of' &&
    thirdToken === 'the' &&
    fourthToken === 'time'
  ) {
    return 4
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_OF_TIMES_HEAD_TOKENS.has(firstToken) &&
    secondToken === 'of' &&
    thirdToken === 'times'
  ) {
    return 3
  }

  const countBasedSequenceLength = matchCountBasedTimeSubordinateClauseSequenceLengthAt(
    tokens,
    startIndex,
  )
  if (countBasedSequenceLength !== undefined) {
    return countBasedSequenceLength
  }

  const articleLedSequenceLength = matchArticleLedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
    tokens,
    startIndex,
  )
  if (articleLedSequenceLength !== undefined) {
    return articleLedSequenceLength
  }

  if (
    firstToken === 'the' &&
    (secondToken === 'other' || secondToken === 'same') &&
    thirdToken === 'time'
  ) {
    return 3
  }

  if (
    firstToken === 'at' &&
    secondToken === 'the' &&
    thirdToken === 'same' &&
    fourthToken === 'time'
  ) {
    return 4
  }

  if (
    firstToken === 'by' &&
    secondToken === 'the' &&
    thirdToken === 'same' &&
    fourthToken === 'time'
  ) {
    return 4
  }

  if (
    (firstToken === 'for' || firstToken === 'from') &&
    secondToken === 'the'
  ) {
    const prepositionalTimeSequenceLength = matchGenericTimeSubordinateClauseSequenceLengthAt(
      tokens,
      startIndex + 2,
    )
    if (prepositionalTimeSequenceLength !== undefined) {
      return prepositionalTimeSequenceLength + 2
    }
  }

  return undefined
}

function matchArticleLedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const articleToken = tokens[startIndex]
  if (articleToken !== 'a' && articleToken !== 'an') {
    return undefined
  }

  let articleLedHeadIndex = startIndex + 1

  while (
    articleLedHeadIndex < tokens.length &&
    isArticleLedQuantifiedTimeModifierToken(tokens[articleLedHeadIndex])
  ) {
    articleLedHeadIndex += 1
  }

  const articleLedHeadToken = tokens[articleLedHeadIndex]
  const articleLedNextToken = tokens[articleLedHeadIndex + 1]
  const articleLedThirdToken = tokens[articleLedHeadIndex + 2]
  const articleLedFourthToken = tokens[articleLedHeadIndex + 3]
  const articleLedFifthToken = tokens[articleLedHeadIndex + 4]
  const articleLedSixthToken = tokens[articleLedHeadIndex + 5]
  const articleLedSeventhToken = tokens[articleLedHeadIndex + 6]

  const articleLedOrdinalSequenceLength = matchOrdinalTimeSubordinateClauseSequenceLengthAt(
    tokens,
    articleLedHeadIndex,
  )
  if (articleLedOrdinalSequenceLength !== undefined) {
    return articleLedHeadIndex - startIndex + articleLedOrdinalSequenceLength
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken === 'times'
  ) {
    return articleLedHeadIndex - startIndex + 2
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedNextToken) &&
    articleLedThirdToken === 'times'
  ) {
    return articleLedHeadIndex - startIndex + 3
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedNextToken) &&
    articleLedThirdToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(articleLedThirdToken) &&
    articleLedFourthToken === 'times'
  ) {
    return articleLedHeadIndex - startIndex + 4
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedNextToken) &&
    articleLedThirdToken === 'and' &&
    articleLedFourthToken === 'a' &&
    articleLedFifthToken === 'half' &&
    (articleLedSixthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
        articleLedSixthToken ?? '',
      ) &&
        articleLedSeventhToken === 'times'))
  ) {
    return articleLedHeadIndex - startIndex + (articleLedSixthToken === 'times' ? 6 : 7)
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedNextToken) &&
    articleLedThirdToken === 'or' &&
    articleLedFourthToken &&
    SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(articleLedFourthToken) &&
    (articleLedFifthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
        articleLedFifthToken ?? '',
      ) &&
        articleLedSixthToken === 'times'))
  ) {
    return articleLedHeadIndex - startIndex + (articleLedFifthToken === 'times' ? 5 : 6)
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedNextToken) &&
    articleLedThirdToken === 'or'
  ) {
    const cardinalRangeLength = matchTimeCardinalSequenceLengthAt(tokens, articleLedHeadIndex + 3)
    if (cardinalRangeLength !== undefined) {
      const afterCardinalIndex = articleLedHeadIndex + 3 + cardinalRangeLength
      if (tokens[afterCardinalIndex] === 'times') {
        return afterCardinalIndex - startIndex + 1
      }

      if (
        SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
          tokens[afterCardinalIndex] ?? '',
        ) &&
        tokens[afterCardinalIndex + 1] === 'times'
      ) {
        return afterCardinalIndex - startIndex + 2
      }
    }
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken === 'or' &&
    isSingleTokenCardinalTimeLeadingToken(articleLedThirdToken) &&
    ((articleLedFourthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
        articleLedFourthToken ?? '',
      ) &&
        articleLedFifthToken === 'times')) ||
      (articleLedFourthToken &&
        SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedFourthToken) &&
        (articleLedFifthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
            articleLedFifthToken ?? '',
          ) &&
            articleLedSixthToken === 'times'))))
  ) {
    if (articleLedFourthToken === 'times') {
      return articleLedHeadIndex - startIndex + 4
    }

    if (
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
        articleLedFourthToken ?? '',
      )
    ) {
      return articleLedHeadIndex - startIndex + 5
    }

    return articleLedHeadIndex - startIndex + (articleLedFifthToken === 'times' ? 5 : 6)
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken === 'or' &&
    ((articleLedThirdToken &&
      SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(articleLedThirdToken) &&
      (articleLedFourthToken === 'times' ||
        (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
          articleLedFourthToken ?? '',
        ) &&
          articleLedFifthToken === 'times'))) ||
      (isSingleTokenCardinalTimeLeadingToken(articleLedThirdToken) &&
        (articleLedFourthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
            articleLedFourthToken ?? '',
          ) &&
            articleLedFifthToken === 'times'))))
  ) {
    return articleLedHeadIndex - startIndex + (articleLedFourthToken === 'times' ? 4 : 5)
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken === 'and' &&
    articleLedThirdToken === 'a' &&
    articleLedFourthToken === 'half' &&
    (articleLedFifthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
        articleLedFifthToken ?? '',
      ) &&
        articleLedSixthToken === 'times'))
  ) {
    return articleLedHeadIndex - startIndex + (articleLedFifthToken === 'times' ? 5 : 6)
  }

  if (
    articleLedHeadToken &&
    (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS.has(articleLedHeadToken) ||
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedHeadToken)) &&
    articleLedNextToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(articleLedNextToken) &&
    articleLedThirdToken === 'times'
  ) {
    return articleLedHeadIndex - startIndex + 3
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken === 'times'
  ) {
    return articleLedHeadIndex - startIndex + 2
  }

  if (
    articleLedHeadToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OF_TIMES_HEAD_TOKENS.has(articleLedHeadToken) &&
    articleLedNextToken === 'of' &&
    articleLedThirdToken === 'times'
  ) {
    return articleLedHeadIndex - startIndex + 3
  }

  return undefined
}

function matchArticleStrippedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  let headIndex = startIndex

  while (
    headIndex < tokens.length &&
    SUBORDINATE_CLAUSE_TIME_PRE_ARTICLE_PREFIX_TOKENS.has(tokens[headIndex] ?? '')
  ) {
    headIndex += 1
  }

  const articleLedSequenceLength = matchArticleLedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
    tokens,
    headIndex,
  )
  if (articleLedSequenceLength !== undefined) {
    return headIndex - startIndex + articleLedSequenceLength
  }

  while (
    headIndex < tokens.length &&
    isArticleLedQuantifiedTimeModifierToken(tokens[headIndex])
  ) {
    headIndex += 1
  }

  const headToken = tokens[headIndex]
  const nextToken = tokens[headIndex + 1]
  const thirdToken = tokens[headIndex + 2]
  const fourthToken = tokens[headIndex + 3]
  const fifthToken = tokens[headIndex + 4]
  const sixthToken = tokens[headIndex + 5]
  const seventhToken = tokens[headIndex + 6]

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS.has(headToken) &&
    nextToken === 'times'
  ) {
    return headIndex - startIndex + 2
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken === 'times'
  ) {
    return headIndex - startIndex + 3
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(thirdToken) &&
    fourthToken === 'times'
  ) {
    return headIndex - startIndex + 4
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken === 'and' &&
    fourthToken === 'a' &&
    fifthToken === 'half' &&
    (sixthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(sixthToken ?? '') &&
        seventhToken === 'times'))
  ) {
    return headIndex - startIndex + (sixthToken === 'times' ? 6 : 7)
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken === 'or' &&
    fourthToken &&
    SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(fourthToken) &&
    (fifthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fifthToken ?? '') &&
        sixthToken === 'times'))
  ) {
    return headIndex - startIndex + (fifthToken === 'times' ? 5 : 6)
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken === 'or'
  ) {
    const cardinalRangeLength = matchTimeCardinalSequenceLengthAt(tokens, headIndex + 3)
    if (cardinalRangeLength !== undefined) {
      const afterCardinalIndex = headIndex + 3 + cardinalRangeLength
      if (tokens[afterCardinalIndex] === 'times') {
        return afterCardinalIndex - startIndex + 1
      }

      if (
        SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
          tokens[afterCardinalIndex] ?? '',
        ) &&
        tokens[afterCardinalIndex + 1] === 'times'
      ) {
        return afterCardinalIndex - startIndex + 2
      }
    }
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS.has(headToken) &&
    nextToken === 'or' &&
    isSingleTokenCardinalTimeLeadingToken(thirdToken) &&
    ((fourthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '') &&
        fifthToken === 'times')) ||
      (fourthToken &&
        SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(fourthToken) &&
        (fifthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
            fifthToken ?? '',
          ) &&
            sixthToken === 'times'))))
  ) {
    if (fourthToken === 'times') {
      return headIndex - startIndex + 4
    }

    if (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '')) {
      return headIndex - startIndex + 5
    }

    return headIndex - startIndex + (fifthToken === 'times' ? 5 : 6)
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(headToken) &&
    nextToken === 'or' &&
    ((thirdToken &&
      SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(thirdToken) &&
      (fourthToken === 'times' ||
        (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '') &&
          fifthToken === 'times'))) ||
      (isSingleTokenCardinalTimeLeadingToken(thirdToken) &&
        (fourthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
            fourthToken ?? '',
          ) &&
            fifthToken === 'times'))))
  ) {
    return headIndex - startIndex + (fourthToken === 'times' ? 4 : 5)
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(headToken) &&
    nextToken === 'and' &&
    thirdToken === 'a' &&
    fourthToken === 'half' &&
    (fifthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fifthToken ?? '') &&
        sixthToken === 'times'))
  ) {
    return headIndex - startIndex + (fifthToken === 'times' ? 5 : 6)
  }

  if (
    headToken &&
    (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS.has(headToken) ||
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(headToken)) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(nextToken) &&
    thirdToken === 'times'
  ) {
    return headIndex - startIndex + 3
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(headToken) &&
    nextToken === 'times'
  ) {
    return headIndex - startIndex + 2
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OF_TIMES_HEAD_TOKENS.has(headToken) &&
    nextToken === 'of' &&
    thirdToken === 'times'
  ) {
    return headIndex - startIndex + 3
  }

  return undefined
}

function isArticleLedQuantifiedTimeModifierToken(token: string | undefined) {
  return Boolean(
    token &&
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_MODIFIER_TOKENS.has(token) ||
        /^[a-z]+ly$/i.test(token)),
  )
}

function matchLeadingSubordinateClauseSequenceLength(tokens: string[]) {
  const explicitSequenceLength = matchLeadingTokenSequenceLength(
    tokens,
    SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES,
  )
  if (explicitSequenceLength !== undefined) {
    return explicitSequenceLength
  }

  const durationUnitTemporalSequenceLength = matchDurationUnitTemporalPhraseSequenceLengthAt(
    tokens,
    0,
  )
  if (durationUnitTemporalSequenceLength !== undefined) {
    return durationUnitTemporalSequenceLength
  }

  const prepositionalTimeSequenceLength = matchPrepositionalTimeSubordinateClauseSequenceLengthAt(
    tokens,
    0,
  )
  if (prepositionalTimeSequenceLength !== undefined) {
    return prepositionalTimeSequenceLength
  }

  const articleStrippedQuantifiedTimeSequenceLength =
    matchArticleStrippedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(tokens, 0)
  if (articleStrippedQuantifiedTimeSequenceLength !== undefined) {
    return articleStrippedQuantifiedTimeSequenceLength
  }

  if (tokens[0] === 'the') {
    const articleStrippedSequenceLength = matchGenericTimeSubordinateClauseSequenceLengthAt(
      tokens,
      1,
    )
    if (articleStrippedSequenceLength !== undefined) {
      return articleStrippedSequenceLength + 1
    }
  }

  return matchGenericTimeSubordinateClauseSequenceLengthAt(tokens, 0)
}

function startsWithMultiTokenSubordinateClauseSequence(tokens: string[]) {
  const leadingSequenceLength =
    matchLeadingTokenSequenceLength(tokens, MULTI_TOKEN_SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES) ??
    matchDurationUnitTemporalPhraseSequenceLengthAt(tokens, 0) ??
    matchPrepositionalTimeSubordinateClauseSequenceLengthAt(tokens, 0) ??
    matchArticleStrippedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(tokens, 0) ??
    matchGenericTimeSubordinateClauseSequenceLengthAt(tokens, 0) ??
    (tokens[0] === 'the'
      ? (() => {
          const articleStrippedSequenceLength = matchGenericTimeSubordinateClauseSequenceLengthAt(
            tokens,
            1,
          )
          return articleStrippedSequenceLength !== undefined
            ? articleStrippedSequenceLength + 1
            : undefined
        })()
      : undefined)

  return leadingSequenceLength !== undefined && leadingSequenceLength > 1
}

function matchPrepositionalTimeSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstToken = tokens[startIndex]
  if (
    !firstToken ||
    !SUBORDINATE_CLAUSE_PREPOSITIONAL_TIME_LEADING_TOKENS.has(firstToken)
  ) {
    return undefined
  }

  const nestedGenericTimeSequenceLength = matchGenericTimeSubordinateClauseSequenceLengthAt(
    tokens,
    startIndex + 1,
  )
  if (nestedGenericTimeSequenceLength !== undefined) {
    return nestedGenericTimeSequenceLength + 1
  }

  const articleToken = tokens[startIndex + 1]
  if (articleToken !== 'the' && articleToken !== 'a' && articleToken !== 'an') {
    return undefined
  }

  if (articleToken === 'a' || articleToken === 'an') {
    const articleLedOrdinalSequenceLength = matchOrdinalTimeSubordinateClauseSequenceLengthAt(
      tokens,
      startIndex + 2,
    )
    if (articleLedOrdinalSequenceLength !== undefined) {
      return articleLedOrdinalSequenceLength + 2
    }

    return undefined
  }

  const pointHeadToken = tokens[startIndex + 2]
  if (
    pointHeadToken &&
    SUBORDINATE_CLAUSE_PREPOSITIONAL_TIME_POINT_HEAD_TOKENS.has(pointHeadToken)
  ) {
    return 3
  }

  const nestedTimeSequenceLength = matchGenericTimeSubordinateClauseSequenceLengthAt(
    tokens,
    startIndex + 2,
  )
  if (nestedTimeSequenceLength !== undefined) {
    return nestedTimeSequenceLength + 2
  }

  return undefined
}

const QUESTION_ANSWER_TOPIC_LEADING_LABEL_REJECT_TOKENS = new Set([
  'do',
  'does',
  'did',
  'keep',
  'keeps',
  'keeping',
  'kept',
  'means',
  'require',
  'requires',
  'required',
  'start',
  'starts',
  'started',
  'then',
  'use',
  'uses',
  'used',
  'when',
  ...SUBORDINATE_CLAUSE_LEADING_WORDS,
])

function formatQuotedValueList(values: string[]) {
  return values.map((value) => `"${value}"`).join(', ')
}

function questionAnswerLabelHasRejectedLeadingTokens(labelTokens: string[]) {
  return (
    labelTokens.length === 0 ||
    labelTokens.some((token) => QUESTION_ANSWER_TOPIC_LEADING_LABEL_REJECT_TOKENS.has(token)) ||
    startsWithMultiTokenSubordinateClauseSequence(labelTokens)
  )
}

function extractQuestionAnswerLeadingTopicSummary(text: string) {
  const trimmed = stripLeadingTopicPromptConjunction(text)
  if (!trimmed) {
    return undefined
  }

  const label = matchLeadingTopicAuthority(trimmed)?.label
  if (!label) {
    return undefined
  }

  const normalizedLabel = normalizeSourceResponseLabel(label)
  if (!normalizedLabel) {
    return undefined
  }

  const labelTokens = normalizedLabel.split(' ').filter(Boolean)
  if (questionAnswerLabelHasRejectedLeadingTokens(labelTokens)) {
    return undefined
  }

  return normalizeExtractedTopicSummary(label, true)
}

function matchLeadingTopicAuthorityAllowBarePredicate(text: string) {
  return new RegExp(
    `^(?<label>.+?)\\s+(?<answer>${TOPIC_SUMMARY_VERB_PATTERN}\\b.*)$`,
    'i',
  ).exec(text)?.groups
}

function extractIncompleteLeadingTopicAuthoritySummary(text: string) {
  const trimmed = stripLeadingTopicPromptConjunction(text)
  if (!trimmed) {
    return undefined
  }

  const groups = matchLeadingTopicAuthorityAllowBarePredicate(trimmed)
  const label = groups?.label
  const answer = groups?.answer
  if (!label || answer === undefined || topicPredicateIncludesSubstantiveAnswerContent(answer)) {
    return undefined
  }

  return normalizeExtractedTopicSummary(label, true)
}

function extractNestedLeadingTopicAuthoritySummary(text: string): string | undefined {
  const trimmed = stripLeadingTopicPromptConjunction(text)
  if (!trimmed) {
    return undefined
  }

  const groups = matchLeadingTopicAuthorityAllowBarePredicate(trimmed)
  const label = groups?.label
  const answer = groups?.answer
  if (!label || answer === undefined || !normalizeExtractedTopicSummary(label, true)) {
    return undefined
  }

  const strippedAnswer = answer
    .trim()
    .replace(new RegExp(`^(?:${TOPIC_SUMMARY_VERB_PATTERN})\\b\\s*`, 'i'), '')
    .trim()
  if (!strippedAnswer) {
    return undefined
  }

  const nestedLabel = matchLeadingTopicAuthorityAllowBarePredicate(strippedAnswer)?.label
  const nestedSummary = nestedLabel ? normalizeExtractedTopicSummary(nestedLabel, true) : undefined
  return nestedSummary ?? extractNestedLeadingTopicAuthoritySummary(strippedAnswer)
}

function sanitizeQuestionAnswerExplicitTopicSummary(summary: string | undefined) {
  if (!summary) {
    return undefined
  }

  const normalizedSummary = normalizeSourceResponseLabel(summary)
  if (!normalizedSummary) {
    return undefined
  }

  const labelTokens = normalizedSummary.split(' ').filter(Boolean)
  if (questionAnswerLabelHasRejectedLeadingTokens(labelTokens)) {
    return undefined
  }

  return summary
}

function extractExplicitTopicSummariesFromQuestionAnswerSentence(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return []
  }

  const hasExplicitInlineTopicDelimiter =
    /^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/u.test(trimmed) ||
    /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/u.test(trimmed)
  const inlineTopicSummary = sanitizeQuestionAnswerExplicitTopicSummary(
    hasExplicitInlineTopicDelimiter
      ? normalizeExtractedTopicSummary(parseInlineTopicClause(trimmed)?.label ?? '', true)
      : undefined,
  )
  const prefixed = sanitizeQuestionAnswerExplicitTopicSummary(extractPrefixedTopicSummary(trimmed))
  const asTopic = sanitizeQuestionAnswerExplicitTopicSummary(extractAsTopicSummary(trimmed))
  const trailing = sanitizeQuestionAnswerExplicitTopicSummary(extractTrailingTopicSummary(trimmed))
  const copular = sanitizeQuestionAnswerExplicitTopicSummary(extractCopularTopicSummary(trimmed))
  const leading = copular ? undefined : extractQuestionAnswerLeadingTopicSummary(trimmed)

  return dedupeNonEmptyStrings([inlineTopicSummary, prefixed, asTopic, trailing, copular, leading])
}

function extractExplicitTopicSummariesFromQuestionAnswerText(answer: string) {
  return dedupeNonEmptyStrings(
    parseTopicSourceResponseSentences(answer).flatMap((sentence) =>
      extractExplicitTopicSummariesFromQuestionAnswerSentence(sentence.text),
    ),
  )
}

function extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText(answer: string) {
  return dedupeNonEmptyStrings(
    parseTopicSourceResponseSentences(answer).flatMap((sentence) => {
      const summary = extractIncompleteLeadingTopicAuthoritySummary(sentence.text)
      return summary ? [summary] : []
    }),
  )
}

function collectDirectAnswerTextAuthoritySegments(answer: string) {
  const clauses = parseTopicSourceResponseClauses(answer).map((clause) => clause.text)
  const conjunctions = parsePendingSourceResponseConjunctions(answer)
  return dedupeNonEmptyStrings([
    ...parseTopicSourceResponseSentences(answer).map((sentence) => sentence.text),
    ...(clauses.length > 1 ? clauses : []),
    ...(conjunctions.length > 1 ? conjunctions : []),
  ])
}

function extractExplicitTopicSummariesFromDirectAnswerText(answer: string) {
  return dedupeNonEmptyStrings(
    collectDirectAnswerTextAuthoritySegments(answer).flatMap((segment) =>
      extractExplicitTopicSummariesFromQuestionAnswerSentence(segment),
    ),
  )
}

function extractIncompleteLeadingTopicAuthoritySummariesFromDirectAnswerText(answer: string) {
  return dedupeNonEmptyStrings(
    collectDirectAnswerTextAuthoritySegments(answer).flatMap((segment) => {
      const summary = extractIncompleteLeadingTopicAuthoritySummary(segment)
      return summary ? [summary] : []
    }),
  )
}

function extractNestedLeadingTopicAuthoritySummariesFromDirectAnswerText(answer: string) {
  return dedupeNonEmptyStrings(
    collectDirectAnswerTextAuthoritySegments(answer).flatMap((segment) => {
      const summary = extractNestedLeadingTopicAuthoritySummary(segment)
      return summary ? [summary] : []
    }),
  )
}

const NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS = new Set([
  "aren't",
  'are',
  "can't",
  'can',
  'cannot',
  "couldn't",
  'could',
  "didn't",
  'did',
  "doesn't",
  'does',
  "hadn't",
  'had',
  "haven't",
  "hasn't",
  'has',
  'how',
  "isn't",
  'is',
  'may',
  "mayn't",
  'might',
  "mightn't",
  'must',
  "mustn't",
  "needn't",
  'ought',
  "oughtn't",
  "shan't",
  'shall',
  "shouldn't",
  'should',
  "wasn't",
  'was',
  "weren't",
  'were',
  'when',
  'where',
  'what',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  "won't",
  'will',
  "wouldn't",
  'would',
])

const CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS = new Set([
  'am',
  "don't",
  'do',
  'have',
  'need',
])

const NON_PUNCTUATED_INTERROGATIVE_WH_LEADING_WORDS = new Set([
  'how',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
])

const NON_PUNCTUATED_INTERROGATIVE_ADVERB_LEADING_WORDS = new Set([
  'how',
  'when',
  'where',
  'why',
])

const NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS = new Set([
  'am',
  "aren't",
  'are',
  'be',
  'been',
  'being',
  "can't",
  'can',
  'cannot',
  "couldn't",
  'could',
  "didn't",
  'did',
  'do',
  "doesn't",
  'does',
  "hadn't",
  'had',
  "haven't",
  "hasn't",
  'has',
  'have',
  "isn't",
  'is',
  'may',
  "mayn't",
  'might',
  "mightn't",
  'must',
  "mustn't",
  "needn't",
  'ought',
  "oughtn't",
  "shan't",
  'shall',
  "shouldn't",
  'should',
  "wasn't",
  'was',
  "weren't",
  'were',
  "won't",
  'will',
  "wouldn't",
  'would',
])

const NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS = new Set([
  'am',
  'are',
  'be',
  'been',
  'being',
  'is',
  'was',
  'were',
])

const NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS = new Set([
  'remain',
  'remained',
  'remains',
  'stay',
  'stayed',
  'stays',
])

const NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_LEXICAL_PREDICATE_TOKENS = new Set([
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
])

const NON_PUNCTUATED_INTERROGATIVE_HOW_QUESTION_SECOND_WORDS = new Set([
  'far',
  'few',
  'little',
  'long',
  'many',
  'much',
  'often',
  'soon',
])

const NON_PUNCTUATED_INTERROGATIVE_HOW_EMBEDDED_CLAUSE_SECOND_WORDS = new Set([
  'far',
  'few',
  'little',
  'long',
  'many',
  'much',
  'often',
  'soon',
])

const CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS = new Set([
  'a',
  'an',
  'he',
  'her',
  'his',
  'i',
  'it',
  'its',
  'my',
  'our',
  'she',
  'that',
  'their',
  'the',
  'these',
  'they',
  'this',
  'those',
  'we',
  'you',
  'your',
])

const NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS = new Set([
  'already',
  'also',
  'actually',
  'basically',
  'certainly',
  'clearly',
  'conceivably',
  'currently',
  'definitely',
  'effectively',
  'even',
  'essentially',
  'ever',
  'generally',
  'just',
  'largely',
  'maybe',
  'merely',
  'mostly',
  'not',
  'now',
  'obviously',
  'only',
  'perhaps',
  'plainly',
  'possibly',
  'presumably',
  'probably',
  'really',
  'simply',
  'strictly',
  'surely',
  'still',
  'then',
  'today',
  'virtually',
  'yet',
])

const NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_TOKEN_SEQUENCES = [
  ['a', 'bit'],
  ['a', 'fair', 'bit'],
  ['a', 'good', 'deal'],
  ['a', 'great', 'deal'],
  ['a', 'little'],
  ['a', 'little', 'bit'],
  ['a', 'lot'],
  ['a', 'whole', 'lot'],
  ['all', 'the', 'more'],
  ['all', 'too'],
  ['any', 'longer'],
  ['any', 'more'],
  ['at', 'the', 'least'],
  ['at', 'the', 'very', 'least'],
  ['by', 'now'],
  ['just', 'about'],
  ['just', 'plain'],
  ['kind', 'of'],
  ['less', 'and', 'less'],
  ['more', 'or', 'less'],
  ['more', 'and', 'more'],
  ['no', 'longer'],
  ['no', 'more'],
  ['sort', 'of'],
  ['at', 'all'],
  ['at', 'least'],
  ['at', 'most'],
  ['way', 'less'],
  ['way', 'more'],
] as const

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PREDICATE_LOOKAHEAD = 5
const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_CHAIN_LOOKBACK = 10

const NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'at',
  'because',
  'before',
  'but',
  'by',
  'for',
  'from',
  'if',
  'in',
  'into',
  'of',
  'on',
  'onto',
  'or',
  'so',
  'than',
  'that',
  'the',
  'these',
  'this',
  'those',
  'to',
  'under',
  'until',
  'when',
  'where',
  'while',
  'with',
  'without',
])

const CONTEXTUAL_BARE_HAVE_PARTICIPLE_PREDICATE_WORDS = new Set([
  'become',
  'been',
  'begun',
  'broken',
  'built',
  'come',
  'done',
  'drawn',
  'driven',
  'fallen',
  'felt',
  'found',
  'gone',
  'grown',
  'held',
  'kept',
  'known',
  'left',
  'lost',
  'made',
  'met',
  'put',
  'read',
  'run',
  'said',
  'seen',
  'sent',
  'set',
  'shown',
  'spent',
  'stood',
  'taken',
  'told',
  'understood',
  'won',
  'written',
])

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_TOKENS = new Set([
  'appear',
  'appeared',
  'appears',
  'continue',
  'continued',
  'continues',
  'come',
  'came',
  'comes',
  'grow',
  'grew',
  'grows',
  'get',
  'gets',
  'got',
  'happen',
  'happened',
  'happens',
  'need',
  'needed',
  'needs',
  'prove',
  'proved',
  'proves',
  'remain',
  'remained',
  'remains',
  'seem',
  'seemed',
  'seems',
  'tend',
  'tended',
  'tends',
  'used',
])

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_COPULAR_SUPPORT_TOKENS = new Set([
  'apt',
  'bound',
  'certain',
  'due',
  'liable',
  'likely',
  'meant',
  'ready',
  'set',
  'sure',
  'unlikely',
])

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_COPULAR_SUPPORT_MODIFIER_TOKENS = new Set([
  'almost',
  'extremely',
  'far',
  'fairly',
  'highly',
  'least',
  'less',
  'more',
  'most',
  'much',
  'nearly',
  'quite',
  'rather',
  'somewhat',
  'too',
  'very',
])

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_NEGATIVE_COPULA_TOKENS = new Set([
  "aren't",
  "isn't",
  "wasn't",
  "weren't",
])

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_TERMINAL_COPULA_LOOKBACK = 10

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PHRASAL_SUPPORT_TOKENS = new Set([
  'turn',
  'turned',
  'turns',
])

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_STARTER_TOKENS = new Set([
  "there'd",
  "there'll",
  "there've",
])

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_COPULA_TOKENS = new Set([
  "there's",
  "there're",
])

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_SUPPORT_TOKENS = new Set([
  'keep',
  'keeps',
  'kept',
  'stop',
  'stopped',
  'stops',
])

const NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_PHRASAL_SUPPORT_CHAINS = [
  {
    verbs: new Set(['end', 'ended', 'ends']),
    particle: 'up',
  },
  {
    verbs: new Set(['go', 'goes', 'went']),
    particle: 'on',
  },
  {
    verbs: new Set(['wind', 'winds', 'wound']),
    particle: 'up',
  },
] as const

function isNonPunctuatedWhExistentialStarterToken(token: string | undefined) {
  return Boolean(
    token &&
      (token === 'there' ||
        NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_STARTER_TOKENS.has(token) ||
        NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_COPULA_TOKENS.has(token)),
  )
}

function isNonPunctuatedWhExistentialSupportVerbToken(token: string | undefined) {
  if (!token) {
    return false
  }

  if (
    NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_TOKENS.has(token) ||
    NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PHRASAL_SUPPORT_TOKENS.has(token) ||
    NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_SUPPORT_TOKENS.has(token)
  ) {
    return true
  }

  return NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_PHRASAL_SUPPORT_CHAINS.some((chain) =>
    chain.verbs.has(token),
  )
}

function looksLikeNonPunctuatedWhExistentialCopularSupportToken(token: string | undefined) {
  return Boolean(
    token &&
      !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) &&
      (NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_COPULAR_SUPPORT_TOKENS.has(token) ||
        /(?:ed|en)$/iu.test(token)),
  )
}

function isNonPunctuatedWhExistentialCopulaToken(token: string | undefined) {
  return Boolean(
    token &&
      (NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
        NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_NEGATIVE_COPULA_TOKENS.has(token)),
  )
}

function looksLikeNonPunctuatedWhExistentialCopularSupportModifierToken(
  token: string | undefined,
) {
  return Boolean(
    token &&
      !looksLikeNonPunctuatedWhExistentialCopularSupportToken(token) &&
      (NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_COPULAR_SUPPORT_MODIFIER_TOKENS.has(token) ||
        /ly$/iu.test(token)),
  )
}

function skipNonPunctuatedInterrogativePredicateFillers(
  tokens: EmbeddedMatchingRunToken[],
  tokenIndex: number,
) {
  let nextTokenIndex = tokenIndex
  while (nextTokenIndex < tokens.length) {
    const matchedSequence =
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_TOKEN_SEQUENCES.filter((sequence) =>
        sequence.every(
          (token, sequenceIndex) =>
            tokens[nextTokenIndex + sequenceIndex]?.normalizedText === token,
        ),
      ).sort((leftSequence, rightSequence) => rightSequence.length - leftSequence.length)[0]
    if (matchedSequence) {
      nextTokenIndex += matchedSequence.length
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(
        tokens[nextTokenIndex]?.normalizedText ?? '',
      )
    ) {
      nextTokenIndex += 1
      continue
    }

    break
  }
  return nextTokenIndex
}

function skipNonPunctuatedWhExistentialCopularSupportPrefixes(
  tokens: EmbeddedMatchingRunToken[],
  tokenIndex: number,
) {
  let nextTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex)
  while (
    looksLikeNonPunctuatedWhExistentialCopularSupportModifierToken(
      tokens[nextTokenIndex]?.normalizedText,
    )
  ) {
    nextTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, nextTokenIndex + 1)
  }
  return nextTokenIndex
}

function findNonPunctuatedWhExistentialCopularSupportPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  copulaTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    copulaTokenIndex + 1,
  )
  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    )
  ) {
    const supportChainPredicateIndex =
      findNonPunctuatedWhExistentialSupportToPredicateIndex(tokens, supportTokenIndex)
    if (supportChainPredicateIndex !== undefined) {
      return supportChainPredicateIndex
    }
  }

  return undefined
}

function findNonPunctuatedWhExistentialSupportVerbCopularSupportPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  supportVerbTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    supportVerbTokenIndex + 1,
  )
  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    )
  ) {
    const supportChainPredicateIndex =
      findNonPunctuatedWhExistentialSupportToPredicateIndex(tokens, supportTokenIndex)
    if (supportChainPredicateIndex !== undefined) {
      return supportChainPredicateIndex
    }
  }

  return undefined
}

function findNonPunctuatedWhExistentialContractedStarterCopularSupportPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  starterTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    starterTokenIndex + 1,
  )
  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    )
  ) {
    const directPredicateTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
      tokens,
      supportTokenIndex + 1,
    )
    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
        tokens[directPredicateTokenIndex]?.normalizedText ?? '',
      )
    ) {
      return directPredicateTokenIndex
    }

    const supportChainPredicateIndex =
      findNonPunctuatedWhExistentialSupportToPredicateIndex(tokens, supportTokenIndex)
    if (supportChainPredicateIndex !== undefined) {
      return supportChainPredicateIndex
    }
  }

  return undefined
}

function findNonPunctuatedWhExistentialSupportToPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  supportTokenIndex: number,
) {
  const toTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, supportTokenIndex + 1)
  if (tokens[toTokenIndex]?.normalizedText !== 'to') {
    return undefined
  }

  const continuationTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, toTokenIndex + 1)
  if (
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
      tokens[continuationTokenIndex]?.normalizedText ?? '',
    )
  ) {
    return continuationTokenIndex
  }

  if (
    tokens[continuationTokenIndex]?.normalizedText === 'have' ||
    tokens[continuationTokenIndex]?.normalizedText === 'has' ||
    tokens[continuationTokenIndex]?.normalizedText === 'had'
  ) {
    const perfectCopulaPredicateIndex = findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
      tokens,
      continuationTokenIndex + 1,
    )
    if (perfectCopulaPredicateIndex !== undefined) {
      return perfectCopulaPredicateIndex
    }
  }

  return undefined
}

function findNonPunctuatedWhExistentialContractedStarterPerfectPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  starterTokenIndex: number,
) {
  const firstTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, starterTokenIndex + 1)
  if (tokens[firstTokenIndex]?.normalizedText === 'have') {
    const copulaTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, firstTokenIndex + 1)
    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
        tokens[copulaTokenIndex]?.normalizedText ?? '',
      )
    ) {
      return copulaTokenIndex
    }
  }

  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    starterTokenIndex + 1,
  )
  const perfectAuxiliaryTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    supportTokenIndex + 1,
  )
  const copulaTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    perfectAuxiliaryTokenIndex + 1,
  )

  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    ) &&
    tokens[perfectAuxiliaryTokenIndex]?.normalizedText === 'have' &&
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
      tokens[copulaTokenIndex]?.normalizedText ?? '',
    )
  ) {
    return copulaTokenIndex
  }

  return undefined
}

function findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    startTokenIndex,
  )
  if (
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
      tokens[supportTokenIndex]?.normalizedText ?? '',
    )
  ) {
    return supportTokenIndex
  }

  const copulaTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    supportTokenIndex + 1,
  )
  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    ) &&
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
      tokens[copulaTokenIndex]?.normalizedText ?? '',
    )
  ) {
    return copulaTokenIndex
  }

  return undefined
}

function findNonPunctuatedWhExistentialAuxiliaryPerfectPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  auxiliaryTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    auxiliaryTokenIndex + 1,
  )
  const perfectAuxiliaryTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    supportTokenIndex + 1,
  )
  const copulaTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    perfectAuxiliaryTokenIndex + 1,
  )

  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    ) &&
    (tokens[perfectAuxiliaryTokenIndex]?.normalizedText === 'have' ||
      tokens[perfectAuxiliaryTokenIndex]?.normalizedText === 'has' ||
      tokens[perfectAuxiliaryTokenIndex]?.normalizedText === 'had') &&
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
      tokens[copulaTokenIndex]?.normalizedText ?? '',
    )
  ) {
    return copulaTokenIndex
  }

  return undefined
}

function findNonPunctuatedWhExistentialContractedCopulaPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  starterTokenIndex: number,
) {
  if (tokens[starterTokenIndex]?.normalizedText === "there's") {
    const perfectCopulaPredicateIndex = findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
      tokens,
      starterTokenIndex + 1,
    )
    if (perfectCopulaPredicateIndex !== undefined) {
      return perfectCopulaPredicateIndex
    }
  }

  const firstPredicateTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    starterTokenIndex + 1,
  )

  if (
    tokens[firstPredicateTokenIndex]?.normalizedText === 'going' &&
    tokens[firstPredicateTokenIndex + 1]?.normalizedText === 'to' &&
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
      tokens[firstPredicateTokenIndex + 2]?.normalizedText ?? '',
    )
  ) {
    return firstPredicateTokenIndex + 2
  }

  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    starterTokenIndex + 1,
  )

  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    )
  ) {
    const supportChainPredicateIndex =
      findNonPunctuatedWhExistentialSupportToPredicateIndex(tokens, supportTokenIndex)
    if (supportChainPredicateIndex !== undefined) {
      return supportChainPredicateIndex
    }
  }

  return undefined
}

function extractNonPunctuatedInterrogativeLeadingWord(text: string) {
  const match = /^[^a-z0-9]*(?<word>[a-z]+(?:['’][a-z]+)?)/iu.exec(text.trim())?.groups?.word
  return match?.toLowerCase().replaceAll('’', "'")
}

function looksLikePluralNounInterrogativeSubjectHead(token: string) {
  return (
    /^[a-z][a-z0-9'-]*s$/iu.test(token) &&
    !/['’]s$/iu.test(token) &&
    !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
    !looksLikeNonPunctuatedWhExistentialCopularSupportModifierToken(token) &&
    !isNonPunctuatedWhExistentialSupportVerbToken(token) &&
    !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
    !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token)
  )
}

function findContextualBareInterrogativePredicateToken(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (!token || NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token)) {
      continue
    }
    return token
  }

  return undefined
}

function isLikelyBareDoQuestionPredicateToken(token: string | undefined) {
  return Boolean(
    token &&
      !CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      !token.endsWith('ing') &&
      !token.endsWith('ly') &&
      !token.endsWith('s'),
  )
}

function isLikelyBareHaveQuestionPredicateToken(token: string | undefined) {
  return Boolean(
    token &&
      !CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      (/ed$/iu.test(token) || /en$/iu.test(token) || CONTEXTUAL_BARE_HAVE_PARTICIPLE_PREDICATE_WORDS.has(token)),
  )
}

function hasContextualBareInterrogativeSubject(
  tokens: EmbeddedMatchingRunToken[],
  leadingWord: string,
  secondToken: string | undefined,
) {
  if (leadingWord === 'need') {
    if (secondToken === 'there') {
      return true
    }

    if (secondToken && CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(secondToken)) {
      return true
    }

    const predicateToken = findContextualBareInterrogativePredicateToken(tokens, 2)
    return Boolean(
      secondToken &&
        predicateToken &&
        !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(secondToken) &&
        !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(secondToken) &&
        !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(secondToken) &&
        (tokenLooksLikeNonPunctuatedWhClauseSubject(secondToken) ||
          !looksLikeNonPunctuatedWhSubjectClausePredicateHead(secondToken)),
    )
  }

  if (leadingWord === 'have' && secondToken === 'there') {
    return true
  }

  if ((leadingWord === 'do' || leadingWord === "don't") && secondToken === 'there') {
    return true
  }

  if (secondToken && CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(secondToken)) {
    return true
  }

  if (leadingWord !== 'do' && leadingWord !== "don't" && leadingWord !== 'have') {
    return false
  }

  const maxSubjectHeadIndex = Math.min(tokens.length - 2, 3)
  for (let subjectHeadIndex = 1; subjectHeadIndex <= maxSubjectHeadIndex; subjectHeadIndex += 1) {
    const subjectHeadToken = tokens[subjectHeadIndex]?.normalizedText
    if (!subjectHeadToken || !looksLikePluralNounInterrogativeSubjectHead(subjectHeadToken)) {
      continue
    }

    const predicateToken = findContextualBareInterrogativePredicateToken(
      tokens,
      subjectHeadIndex + 1,
    )
    if (
      ((leadingWord === 'do' || leadingWord === "don't") &&
        isLikelyBareDoQuestionPredicateToken(predicateToken)) ||
      (leadingWord === 'have' && isLikelyBareHaveQuestionPredicateToken(predicateToken))
    ) {
      return true
    }
  }

  return false
}

function looksLikeNonPunctuatedWhSubjectClausePredicateHead(token: string | undefined) {
  return Boolean(
    token &&
      !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) &&
      (/ed$/iu.test(token) ||
        /en$/iu.test(token) ||
        /ing$/iu.test(token) ||
        (/s$/iu.test(token) && !/['’]s$/iu.test(token))),
  )
}

function looksLikeNonPunctuatedWhSubjectClauseLexicalToken(token: string | undefined) {
  return Boolean(
    token &&
      !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token),
  )
}

function looksLikeNonPunctuatedWhNounPhraseSubjectHeadToken(token: string | undefined) {
  return Boolean(
    token &&
      !isNonPunctuatedWhExistentialStarterToken(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(token) &&
      !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token),
  )
}

function looksLikeNonPunctuatedWhInfinitiveVerbToken(token: string | undefined) {
  return Boolean(
    token &&
      !CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token),
  )
}

function tokenLooksLikeNonPunctuatedWhClauseSubject(token: string | undefined) {
  return Boolean(
    token &&
      (CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(token) ||
        looksLikePluralNounInterrogativeSubjectHead(token)),
  )
}

function isNonPunctuatedWhInfinitiveClauseDeclarative(tokens: EmbeddedMatchingRunToken[]) {
  const maxInfinitiveTokenIndex = Math.min(tokens.length - 2, 4)
  for (let tokenIndex = 1; tokenIndex <= maxInfinitiveTokenIndex; tokenIndex += 1) {
    if (tokens[tokenIndex]?.normalizedText !== 'to') {
      continue
    }

    if (
      !looksLikeNonPunctuatedWhInfinitiveVerbToken(tokens[tokenIndex + 1]?.normalizedText)
    ) {
      continue
    }

    for (let laterTokenIndex = tokenIndex + 2; laterTokenIndex < tokens.length; laterTokenIndex += 1) {
      const laterToken = tokens[laterTokenIndex]?.normalizedText
      if (
        !laterToken ||
        NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(laterToken) ||
        NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(laterToken)
      ) {
        continue
      }

      if (
        NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(laterToken) ||
        looksLikeNonPunctuatedWhSubjectClausePredicateHead(laterToken)
      ) {
        return true
      }
    }
  }

  return false
}

function findNonPunctuatedWhEmbeddedClausePredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (token && NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_LEXICAL_PREDICATE_TOKENS.has(token)) {
      for (let laterTokenIndex = tokenIndex + 1; laterTokenIndex < tokens.length; laterTokenIndex += 1) {
        const laterToken = tokens[laterTokenIndex]?.normalizedText
        if (
          !laterToken ||
          NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(laterToken) ||
          NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(laterToken)
        ) {
          continue
        }

        if (
          NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(laterToken) ||
          NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(laterToken) ||
          looksLikeNonPunctuatedWhSubjectClausePredicateHead(laterToken)
        ) {
          return tokenIndex
        }

        break
      }
    }

    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) ||
      (tokenLooksLikeNonPunctuatedWhClauseSubject(token) &&
        !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token))
    ) {
      continue
    }

    if (isNonPunctuatedWhExistentialStarterToken(token)) {
      const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
        tokens,
        tokenIndex,
      )
      if (existentialPredicateIndex !== undefined) {
        return existentialPredicateIndex
      }
    }

    return tokenIndex
  }

  return undefined
}

function findNonPunctuatedWhDeclarativeTailPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return tokenIndex
    }
  }

  return undefined
}

function looksLikeNonPunctuatedWhBareClausePredicateToken(token: string | undefined) {
  return Boolean(
    token &&
      !isNonPunctuatedWhExistentialStarterToken(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(token) &&
      !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token) &&
      !looksLikeNonPunctuatedWhNounPhraseSubjectHeadToken(token),
  )
}

function findNonPunctuatedWhExistentialPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  thereTokenIndex: number,
) {
  const starterToken = tokens[thereTokenIndex]?.normalizedText
  if (!isNonPunctuatedWhExistentialStarterToken(starterToken)) {
    return undefined
  }

  if (
    starterToken &&
    NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_COPULA_TOKENS.has(starterToken)
  ) {
    return findNonPunctuatedWhExistentialContractedCopulaPredicateIndex(tokens, thereTokenIndex)
  }

  if (starterToken === "there've") {
    const perfectCopulaPredicateIndex = findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
      tokens,
      thereTokenIndex + 1,
    )
    if (perfectCopulaPredicateIndex !== undefined) {
      return perfectCopulaPredicateIndex
    }
  }

  let lastTokenIndex = Math.min(
    tokens.length - 1,
    thereTokenIndex + NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PREDICATE_LOOKAHEAD,
  )
  for (let tokenIndex = thereTokenIndex + 1; tokenIndex <= lastTokenIndex; tokenIndex += 1) {
    const nonFillerTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex)
    if (nonFillerTokenIndex !== tokenIndex) {
      lastTokenIndex = Math.max(
        lastTokenIndex,
        Math.min(tokens.length - 1, nonFillerTokenIndex),
      )
      tokenIndex = nonFillerTokenIndex - 1
      continue
    }

    const token = tokens[tokenIndex]?.normalizedText
    if (!token || NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token)) {
      continue
    }

    if (
      starterToken &&
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_STARTER_TOKENS.has(starterToken)
    ) {
      const contractedStarterPerfectPredicateIndex =
        findNonPunctuatedWhExistentialContractedStarterPerfectPredicateIndex(
          tokens,
          thereTokenIndex,
        )
      if (contractedStarterPerfectPredicateIndex !== undefined) {
        return contractedStarterPerfectPredicateIndex
      }

      const contractedStarterCopularSupportPredicateIndex =
        findNonPunctuatedWhExistentialContractedStarterCopularSupportPredicateIndex(
          tokens,
          thereTokenIndex,
        )
      if (contractedStarterCopularSupportPredicateIndex !== undefined) {
        return contractedStarterCopularSupportPredicateIndex
      }
    }

    if (token === 'have' || token === 'has' || token === 'had') {
      const perfectCopulaPredicateIndex = findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
        tokens,
        tokenIndex + 1,
      )
      if (perfectCopulaPredicateIndex !== undefined) {
        return perfectCopulaPredicateIndex
      }
    }

    if (
      isNonPunctuatedWhExistentialCopulaToken(token) &&
      tokens[tokenIndex + 1]?.normalizedText === 'going' &&
      tokens[tokenIndex + 2]?.normalizedText === 'to' &&
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
        tokens[tokenIndex + 3]?.normalizedText ?? '',
      )
    ) {
      return tokenIndex + 3
    }

    if (isNonPunctuatedWhExistentialCopulaToken(token)) {
      const copularSupportPredicateIndex =
        findNonPunctuatedWhExistentialCopularSupportPredicateIndex(tokens, tokenIndex)
      if (copularSupportPredicateIndex !== undefined) {
        return copularSupportPredicateIndex
      }
    }

    if (isNonPunctuatedWhExistentialCopulaToken(token)) {
      return tokenIndex
    }

    if (isNonPunctuatedWhExistentialSupportVerbToken(token)) {
      const supportVerbCopularSupportPredicateIndex =
        findNonPunctuatedWhExistentialSupportVerbCopularSupportPredicateIndex(tokens, tokenIndex)
      if (supportVerbCopularSupportPredicateIndex !== undefined) {
        return supportVerbCopularSupportPredicateIndex
      }
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PHRASAL_SUPPORT_TOKENS.has(token) &&
      tokens[tokenIndex + 1]?.normalizedText === 'out' &&
      tokens[
        skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2)
      ]?.normalizedText === 'to' &&
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
        tokens[
          skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2) + 1
        ]?.normalizedText ?? '',
      )
    ) {
      return skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2) + 1
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_SUPPORT_TOKENS.has(token) &&
      tokens[
        skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 1)
      ]?.normalizedText === 'being'
    ) {
      return skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 1)
    }

    for (const chain of NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_PHRASAL_SUPPORT_CHAINS) {
      if (
        chain.verbs.has(token) &&
        tokens[tokenIndex + 1]?.normalizedText === chain.particle &&
        tokens[
          skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2)
        ]?.normalizedText === 'being'
      ) {
        return skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2)
      }
    }

    if (NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token)) {
      const auxiliaryPerfectPredicateIndex =
        findNonPunctuatedWhExistentialAuxiliaryPerfectPredicateIndex(tokens, tokenIndex)
      if (auxiliaryPerfectPredicateIndex !== undefined) {
        return auxiliaryPerfectPredicateIndex
      }
    }

    if (
      token === 'to' ||
      NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_TOKENS.has(token)
    ) {
      continue
    }

    return undefined
  }

  return undefined
}

function isWithinNonPunctuatedWhExistentialSupportChain(
  tokens: EmbeddedMatchingRunToken[],
  tokenIndex: number,
) {
  const firstThereTokenIndex = Math.max(
    0,
    tokenIndex - NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_CHAIN_LOOKBACK,
  )
  for (let thereTokenIndex = firstThereTokenIndex; thereTokenIndex < tokenIndex; thereTokenIndex += 1) {
    if (!isNonPunctuatedWhExistentialStarterToken(tokens[thereTokenIndex]?.normalizedText)) {
      continue
    }

    const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
      tokens,
      thereTokenIndex,
    )
    if (
      existentialPredicateIndex !== undefined &&
      tokenIndex > thereTokenIndex &&
      tokenIndex < existentialPredicateIndex
    ) {
      return true
    }
  }

  return false
}

function isNonPunctuatedWhExistentialTerminalCopula(
  tokens: EmbeddedMatchingRunToken[],
  copulaIndex: number,
) {
  if (
    !NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
      tokens[copulaIndex]?.normalizedText ?? '',
    )
  ) {
    return false
  }

  const firstThereTokenIndex = Math.max(
    0,
    copulaIndex - NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_TERMINAL_COPULA_LOOKBACK,
  )
  for (let thereTokenIndex = firstThereTokenIndex; thereTokenIndex < copulaIndex; thereTokenIndex += 1) {
    if (!isNonPunctuatedWhExistentialStarterToken(tokens[thereTokenIndex]?.normalizedText)) {
      continue
    }

    if (
      findNonPunctuatedWhExistentialPredicateIndex(tokens, thereTokenIndex) === copulaIndex
    ) {
      return true
    }
  }

  return false
}

function findNonPunctuatedWhNounPhraseSubjectClauseInnerPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, tokenIndex)
    ) {
      continue
    }

    if (isNonPunctuatedWhExistentialStarterToken(token)) {
      const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
        tokens,
        tokenIndex,
      )
      if (existentialPredicateIndex !== undefined) {
        return existentialPredicateIndex
      }
    }

    const previousToken = tokens[tokenIndex - 1]?.normalizedText
    if (
      isNonPunctuatedWhExistentialStarterToken(previousToken) &&
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_TOKENS.has(token) &&
      tokens[tokenIndex + 1]?.normalizedText === 'to' &&
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
        tokens[tokenIndex + 2]?.normalizedText ?? '',
      )
    ) {
      continue
    }

    if (
      looksLikePluralNounInterrogativeSubjectHead(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(previousToken) &&
      (NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(tokens[tokenIndex + 1]?.normalizedText ?? '') ||
        NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(
          tokens[tokenIndex + 1]?.normalizedText ?? '',
        ) ||
        findNonPunctuatedWhExistentialPredicateIndex(tokens, tokenIndex + 1) !== undefined ||
        looksLikeNonPunctuatedWhBareClausePredicateToken(tokens[tokenIndex + 1]?.normalizedText))
    ) {
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return tokenIndex
    }

    if (
      looksLikeNonPunctuatedWhBareClausePredicateToken(token) &&
      (looksLikePluralNounInterrogativeSubjectHead(previousToken ?? '') ||
        tokenLooksLikeNonPunctuatedWhClauseSubject(previousToken))
    ) {
      return tokenIndex
    }
  }

  return undefined
}

function resolveNonPunctuatedWhOuterPredicateSearchStart(
  tokens: EmbeddedMatchingRunToken[],
  innerPredicateIndex: number,
) {
  const innerPredicateToken = tokens[innerPredicateIndex]?.normalizedText
  return innerPredicateToken &&
    ((NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(innerPredicateToken) &&
      !isNonPunctuatedWhExistentialTerminalCopula(tokens, innerPredicateIndex) &&
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(tokens[innerPredicateIndex + 1]?.normalizedText)) ||
      (NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(innerPredicateToken) &&
        looksLikeNonPunctuatedWhSubjectClauseLexicalToken(
          tokens[innerPredicateIndex + 1]?.normalizedText,
        )))
    ? innerPredicateIndex + 2
    : innerPredicateIndex + 1
}

function findNonPunctuatedWhOuterClausePredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token)
    ) {
      return tokenIndex
    }

    if (
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token) &&
      (tokenIndex === startIndex ||
        !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(
          tokens[tokenIndex - 1]?.normalizedText ?? '',
        ))
    ) {
      return tokenIndex
    }
  }

  return undefined
}

function looksLikeNonPunctuatedHowEmbeddedClauseSubjectToken(token: string | undefined) {
  return Boolean(
    token &&
      (tokenLooksLikeNonPunctuatedWhClauseSubject(token) ||
        (!isNonPunctuatedWhExistentialStarterToken(token) &&
          !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
          !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
          !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) &&
          !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token))),
  )
}

function isNonPunctuatedWhEmbeddedSubjectClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
) {
  const maxSubjectIndex = Math.min(tokens.length - 3, 5)
  for (let subjectIndex = 1; subjectIndex <= maxSubjectIndex; subjectIndex += 1) {
    const subjectToken = tokens[subjectIndex]?.normalizedText
    if (
      !tokenLooksLikeNonPunctuatedWhClauseSubject(subjectToken) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, subjectIndex)
    ) {
      continue
    }

    const innerPredicateIndex = findNonPunctuatedWhEmbeddedClausePredicateIndex(
      tokens,
      subjectIndex + 1,
    )
    if (innerPredicateIndex === undefined) {
      continue
    }

    const outerPredicateIndex = findNonPunctuatedWhDeclarativeTailPredicateIndex(
      tokens,
      innerPredicateIndex + 1,
    )
    if (outerPredicateIndex !== undefined) {
      return true
    }
  }

  return false
}

function isNonPunctuatedWhNounPhraseSubjectClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
) {
  const maxSubjectHeadIndex = Math.min(tokens.length - 3, 4)
  for (let subjectHeadIndex = 1; subjectHeadIndex <= maxSubjectHeadIndex; subjectHeadIndex += 1) {
    const subjectHeadToken = tokens[subjectHeadIndex]?.normalizedText
    if (!looksLikeNonPunctuatedWhNounPhraseSubjectHeadToken(subjectHeadToken)) {
      continue
    }

    const innerPredicateIndex = findNonPunctuatedWhNounPhraseSubjectClauseInnerPredicateIndex(
      tokens,
      subjectHeadIndex + 1,
    )
    if (innerPredicateIndex === undefined) {
      continue
    }

    const outerPredicateIndex = findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, innerPredicateIndex),
    )
    if (outerPredicateIndex !== undefined) {
      return true
    }
  }

  return false
}

function hasNonPunctuatedWhCommaContinuation(text: string) {
  const commaTail = /^[^,，]+[,，]\s*(?<tail>.+)$/u.exec(text.trim())?.groups?.tail?.trim()
  return Boolean(commaTail && tokenizeEmbeddedMatchingRunSourceResponse(commaTail).length > 0)
}

function findNonPunctuatedWhAdverbClauseInnerPredicateIndex(tokens: EmbeddedMatchingRunToken[]) {
  const predicateIndex = findNonPunctuatedWhDeclarativeTailPredicateIndex(tokens, 2)
  if (predicateIndex !== undefined) {
    return predicateIndex
  }

  if (
    tokenLooksLikeNonPunctuatedWhClauseSubject(tokens[1]?.normalizedText) &&
    looksLikeNonPunctuatedWhSubjectClauseLexicalToken(tokens[2]?.normalizedText)
  ) {
    return 2
  }

  return undefined
}

function isNonPunctuatedWhAdverbClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
  text: string,
) {
  const leadingWord = tokens[0]?.normalizedText
  const secondToken = tokens[1]?.normalizedText
  if (
    !leadingWord ||
    !NON_PUNCTUATED_INTERROGATIVE_ADVERB_LEADING_WORDS.has(leadingWord) ||
    NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(secondToken ?? '')
  ) {
    return false
  }

  if (hasNonPunctuatedWhCommaContinuation(text)) {
    return true
  }

  const innerPredicateIndex = findNonPunctuatedWhAdverbClauseInnerPredicateIndex(tokens)
  if (innerPredicateIndex === undefined) {
    return false
  }

  return (
    findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, innerPredicateIndex),
    ) !== undefined
  )
}

function findNonPunctuatedHowEmbeddedClausePredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, tokenIndex)
    ) {
      continue
    }

    if (isNonPunctuatedWhExistentialStarterToken(token)) {
      const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
        tokens,
        tokenIndex,
      )
      if (existentialPredicateIndex !== undefined) {
        return existentialPredicateIndex
      }
    }

    const previousToken = tokens[tokenIndex - 1]?.normalizedText
    if (
      looksLikePluralNounInterrogativeSubjectHead(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(previousToken) &&
      findNonPunctuatedWhExistentialPredicateIndex(tokens, tokenIndex + 1) !== undefined
    ) {
      continue
    }

    if (
      looksLikeNonPunctuatedWhNounPhraseSubjectHeadToken(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(previousToken) &&
      findNonPunctuatedWhExistentialPredicateIndex(tokens, tokenIndex + 1) !== undefined
    ) {
      continue
    }

    if (
      (token === 'have' || token === 'has' || token === 'had') &&
      tokenLooksLikeNonPunctuatedWhClauseSubject(tokens[tokenIndex - 1]?.normalizedText)
    ) {
      return tokenIndex
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) ||
      (tokenLooksLikeNonPunctuatedWhClauseSubject(token) &&
        !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token))
    ) {
      continue
    }

    return tokenIndex
  }

  return undefined
}

function isNonPunctuatedHowModifierEmbeddedClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
) {
  if (
    tokens[0]?.normalizedText !== 'how' ||
    !NON_PUNCTUATED_INTERROGATIVE_HOW_EMBEDDED_CLAUSE_SECOND_WORDS.has(
      tokens[1]?.normalizedText ?? '',
    )
  ) {
    return false
  }

  const maxSubjectIndex = Math.min(tokens.length - 3, 5)
  for (let subjectIndex = 2; subjectIndex <= maxSubjectIndex; subjectIndex += 1) {
    const subjectToken = tokens[subjectIndex]?.normalizedText
    if (
      !looksLikeNonPunctuatedHowEmbeddedClauseSubjectToken(subjectToken) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, subjectIndex)
    ) {
      continue
    }

    const innerPredicateIndex = findNonPunctuatedHowEmbeddedClausePredicateIndex(
      tokens,
      subjectIndex + 1,
    )
    if (innerPredicateIndex === undefined) {
      continue
    }

    const outerPredicateIndex = findNonPunctuatedWhDeclarativeTailPredicateIndex(
      tokens,
      innerPredicateIndex + 1,
    )
    if (outerPredicateIndex !== undefined) {
      return true
    }
  }

  return false
}

function isNonPunctuatedWhLeadingExistentialClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
) {
  if (!isNonPunctuatedWhExistentialStarterToken(tokens[1]?.normalizedText)) {
    return false
  }

  const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(tokens, 1)
  if (existentialPredicateIndex === undefined) {
    return false
  }

  return (
    findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, existentialPredicateIndex),
    ) !== undefined
  )
}

function findNonPunctuatedWhClauseExistentialStarterIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, tokenIndex)
    ) {
      continue
    }

    if (isNonPunctuatedWhExistentialStarterToken(token)) {
      return tokenIndex
    }
  }

  return undefined
}

function resolveNonPunctuatedWhExistentialClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
  starterTokenIndex: number,
) {
  if (!isNonPunctuatedWhExistentialStarterToken(tokens[starterTokenIndex]?.normalizedText)) {
    return undefined
  }

  const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
    tokens,
    starterTokenIndex,
  )
  if (existentialPredicateIndex === undefined) {
    return undefined
  }

  return (
    findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, existentialPredicateIndex),
    ) !== undefined
  )
}

function isAuxiliaryLedExistentialPluralComplementQuestion(
  tokens: EmbeddedMatchingRunToken[],
  leadingWord: string,
  existentialStarterIndex: number,
) {
  if (
    existentialStarterIndex !== 1 ||
    !(
      NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(leadingWord) ||
      leadingWord === "don't" ||
      leadingWord === 'need'
    )
  ) {
    return false
  }

  const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
    tokens,
    existentialStarterIndex,
  )
  if (existentialPredicateIndex === undefined) {
    return false
  }

  let sawPluralComplementHead = false
  for (
    let tokenIndex = existentialPredicateIndex + 1;
    tokenIndex < tokens.length;
    tokenIndex += 1
  ) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (!sawPluralComplementHead) {
      if (looksLikePluralNounInterrogativeSubjectHead(token)) {
        sawPluralComplementHead = true
      }
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token) ||
      isNonPunctuatedWhExistentialStarterToken(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return false
    }
  }

  return sawPluralComplementHead
}

function isAdverbLedExistentialPluralComplementQuestion(
  tokens: EmbeddedMatchingRunToken[],
  leadingWord: string,
  existentialStarterIndex: number,
) {
  if (
    existentialStarterIndex !== 1 ||
    !NON_PUNCTUATED_INTERROGATIVE_ADVERB_LEADING_WORDS.has(leadingWord)
  ) {
    return false
  }

  const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
    tokens,
    existentialStarterIndex,
  )
  if (existentialPredicateIndex === undefined) {
    return false
  }

  let sawPluralComplementHead = false
  for (
    let tokenIndex = existentialPredicateIndex + 1;
    tokenIndex < tokens.length;
    tokenIndex += 1
  ) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (!sawPluralComplementHead) {
      if (looksLikePluralNounInterrogativeSubjectHead(token)) {
        sawPluralComplementHead = true
      }
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token) ||
      isNonPunctuatedWhExistentialStarterToken(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return false
    }
  }

  return sawPluralComplementHead
}

function hasBareExistentialPluralComplementTail(
  tokens: EmbeddedMatchingRunToken[],
  existentialPredicateIndex: number,
) {
  let sawPluralComplementHead = false
  for (
    let tokenIndex = existentialPredicateIndex + 1;
    tokenIndex < tokens.length;
    tokenIndex += 1
  ) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (!sawPluralComplementHead) {
      if (looksLikePluralNounInterrogativeSubjectHead(token)) {
        sawPluralComplementHead = true
      }
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token) ||
      isNonPunctuatedWhExistentialStarterToken(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return false
    }
  }

  return sawPluralComplementHead
}

function isNonPunctuatedWhClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
  leadingWord: string,
  text: string,
) {
  if (!NON_PUNCTUATED_INTERROGATIVE_WH_LEADING_WORDS.has(leadingWord)) {
    return false
  }

  const secondToken = tokens[1]?.normalizedText
  const existentialStarterIndex = findNonPunctuatedWhClauseExistentialStarterIndex(tokens, 1)
  if (existentialStarterIndex !== undefined) {
    const existentialClauseDeclarative = resolveNonPunctuatedWhExistentialClauseDeclarative(
      tokens,
      existentialStarterIndex,
    )
    if (existentialClauseDeclarative !== undefined) {
      if (
        existentialClauseDeclarative &&
        isAdverbLedExistentialPluralComplementQuestion(
          tokens,
          leadingWord,
          existentialStarterIndex,
        )
      ) {
        return false
      }
      return existentialClauseDeclarative
    }
  }
  if (isNonPunctuatedWhInfinitiveClauseDeclarative(tokens)) {
    return true
  }
  if (isNonPunctuatedHowModifierEmbeddedClauseDeclarative(tokens)) {
    return true
  }
  if (
    !(
      leadingWord === 'how' &&
      NON_PUNCTUATED_INTERROGATIVE_HOW_EMBEDDED_CLAUSE_SECOND_WORDS.has(secondToken ?? '')
    ) &&
    isNonPunctuatedWhEmbeddedSubjectClauseDeclarative(tokens)
  ) {
    return true
  }
  if (isNonPunctuatedWhLeadingExistentialClauseDeclarative(tokens)) {
    return true
  }
  if (leadingWord !== 'how' && isNonPunctuatedWhNounPhraseSubjectClauseDeclarative(tokens)) {
    return true
  }

  const firstDelayedCopulaIndex = tokens.findIndex(
    (token, tokenIndex) =>
      tokenIndex >= 2 &&
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token.normalizedText) &&
      !isNonPunctuatedWhExistentialTerminalCopula(tokens, tokenIndex),
  )
  if (firstDelayedCopulaIndex >= 3) {
    for (let tokenIndex = 1; tokenIndex < firstDelayedCopulaIndex - 1; tokenIndex += 1) {
      if (tokens[tokenIndex]?.normalizedText !== 'to') {
        continue
      }

      if (
        looksLikeNonPunctuatedWhSubjectClauseLexicalToken(tokens[tokenIndex + 1]?.normalizedText)
      ) {
        return true
      }
    }
  }

  if (
    firstDelayedCopulaIndex >= 2 &&
    looksLikeNonPunctuatedWhSubjectClausePredicateHead(tokens[1]?.normalizedText) &&
    !(
      isNonPunctuatedWhExistentialStarterToken(tokens[2]?.normalizedText) &&
      findNonPunctuatedWhExistentialPredicateIndex(tokens, 2) !== undefined
    )
  ) {
    return true
  }

  if (firstDelayedCopulaIndex >= 3) {
    let sawClauseSubject = false
    for (let tokenIndex = 1; tokenIndex < firstDelayedCopulaIndex; tokenIndex += 1) {
      const token = tokens[tokenIndex]?.normalizedText
      if (!token) {
        continue
      }

      if (!sawClauseSubject && tokenLooksLikeNonPunctuatedWhClauseSubject(token)) {
        sawClauseSubject = true
        continue
      }

      if (sawClauseSubject && isWithinNonPunctuatedWhExistentialSupportChain(tokens, tokenIndex)) {
        continue
      }

      if (
        sawClauseSubject &&
        (looksLikeNonPunctuatedWhSubjectClausePredicateHead(token) ||
          looksLikeNonPunctuatedWhBareClausePredicateToken(token))
      ) {
        return true
      }
    }
  }

  if (
    leadingWord === 'how' &&
    NON_PUNCTUATED_INTERROGATIVE_HOW_QUESTION_SECOND_WORDS.has(secondToken ?? '')
  ) {
    return false
  }

  if (isNonPunctuatedWhAdverbClauseDeclarative(tokens, text)) {
    return true
  }

  return false
}

function inferNonPunctuatedInterrogativeQuestionAuthority(sentence: string) {
  const strippedSentence = stripLeadingQuestionPromptConjunction(sentence).trim()
  if (!strippedSentence || /[?？]/u.test(strippedSentence)) {
    return undefined
  }

  const withoutTerminalPunctuation = strippedSentence.replace(/[.!。！]+$/u, '').trim()
  if (!withoutTerminalPunctuation) {
    return undefined
  }

  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(withoutTerminalPunctuation)
  const leadingWord = extractNonPunctuatedInterrogativeLeadingWord(withoutTerminalPunctuation)
  const secondToken = tokens[1]?.normalizedText
  if (
    !leadingWord ||
    (!NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS.has(leadingWord) &&
      !CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS.has(leadingWord)) ||
    tokens.length < 3
  ) {
    return undefined
  }

  if (
    CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS.has(leadingWord) &&
    !hasContextualBareInterrogativeSubject(tokens, leadingWord, secondToken)
  ) {
    return undefined
  }

  const existentialStarterIndex = findNonPunctuatedWhClauseExistentialStarterIndex(tokens, 1)
  if (existentialStarterIndex !== undefined) {
    const existentialClauseDeclarative = resolveNonPunctuatedWhExistentialClauseDeclarative(
      tokens,
      existentialStarterIndex,
    )
    if (existentialClauseDeclarative === false) {
      return normalizeExplicitQuestionSurfaceText(`${withoutTerminalPunctuation}?`)
    }
    if (existentialClauseDeclarative === true) {
      if (
        isAuxiliaryLedExistentialPluralComplementQuestion(
          tokens,
          leadingWord,
          existentialStarterIndex,
        )
      ) {
        return normalizeExplicitQuestionSurfaceText(`${withoutTerminalPunctuation}?`)
      }
      if (
        isAdverbLedExistentialPluralComplementQuestion(
          tokens,
          leadingWord,
          existentialStarterIndex,
        )
      ) {
        return normalizeExplicitQuestionSurfaceText(`${withoutTerminalPunctuation}?`)
      }
      return undefined
    }
  }

  if (isNonPunctuatedWhClauseDeclarative(tokens, leadingWord, withoutTerminalPunctuation)) {
    return undefined
  }

  return normalizeExplicitQuestionSurfaceText(`${withoutTerminalPunctuation}?`)
}

function startsWithNonPunctuatedWhClauseDeclarative(text: string) {
  const strippedText = stripLeadingQuestionPromptConjunction(text).trim()
  if (!strippedText || /[?？]/u.test(strippedText)) {
    return false
  }

  const withoutTerminalPunctuation = strippedText.replace(/[.!。！]+$/u, '').trim()
  if (!withoutTerminalPunctuation) {
    return false
  }

  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(withoutTerminalPunctuation)
  const leadingWord = extractNonPunctuatedInterrogativeLeadingWord(withoutTerminalPunctuation)
  if (
    !leadingWord ||
    !NON_PUNCTUATED_INTERROGATIVE_WH_LEADING_WORDS.has(leadingWord) ||
    tokens.length < 3
  ) {
    return false
  }

  const existentialStarterIndex = findNonPunctuatedWhClauseExistentialStarterIndex(tokens, 1)
  if (existentialStarterIndex !== undefined) {
    const existentialClauseDeclarative = resolveNonPunctuatedWhExistentialClauseDeclarative(
      tokens,
      existentialStarterIndex,
    )
    if (existentialClauseDeclarative !== undefined) {
      if (
        existentialClauseDeclarative &&
        isAdverbLedExistentialPluralComplementQuestion(
          tokens,
          leadingWord,
          existentialStarterIndex,
        )
      ) {
        return false
      }
      return existentialClauseDeclarative
    }
  }

  return isNonPunctuatedWhClauseDeclarative(tokens, leadingWord, withoutTerminalPunctuation)
}

function subordinateClauseHasLaterOuterPredicateOrContinuation(
  tokens: EmbeddedMatchingRunToken[],
  text: string,
  subordinateClauseStartIndex: number,
) {
  if (hasNonPunctuatedWhCommaContinuation(text)) {
    return true
  }

  const subordinateSuffix = text
    .trim()
    .split(/\s+/u)
    .slice(subordinateClauseStartIndex)
    .join(' ')
    .trim()
  if (
    subordinateSuffix &&
    (extractExplicitTopicSummariesFromQuestionAnswerSentence(subordinateSuffix).length > 0 ||
      extractQuestionAuthorityTextsFromText(subordinateSuffix).length > 0)
  ) {
    return true
  }

  const existentialStarterIndex = findNonPunctuatedWhClauseExistentialStarterIndex(
    tokens,
    subordinateClauseStartIndex,
  )
  if (existentialStarterIndex !== undefined) {
    const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
      tokens,
      existentialStarterIndex,
    )
    if (existentialPredicateIndex !== undefined) {
      const outerPredicateIndex = findNonPunctuatedWhOuterClausePredicateIndex(
        tokens,
        resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, existentialPredicateIndex),
      )
      return (
        outerPredicateIndex !== undefined &&
        !hasBareExistentialPluralComplementTail(tokens, existentialPredicateIndex)
      )
    }
  }

  const embeddedSubjectPredicateIndex = findNonPunctuatedWhEmbeddedClausePredicateIndex(
    tokens,
    subordinateClauseStartIndex + 1,
  )
  if (
    embeddedSubjectPredicateIndex !== undefined &&
    findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, embeddedSubjectPredicateIndex),
    ) !== undefined
  ) {
    return true
  }

  const nounPhrasePredicateIndex = findNonPunctuatedWhNounPhraseSubjectClauseInnerPredicateIndex(
    tokens,
    subordinateClauseStartIndex + 1,
  )
  if (
    nounPhrasePredicateIndex !== undefined &&
    findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, nounPhrasePredicateIndex),
    ) !== undefined
  ) {
    return true
  }

  return false
}

function inferSubordinateClauseFragmentAuthority(sentence: string) {
  const strippedSentence = stripLeadingQuestionPromptConjunction(sentence).trim()
  if (!strippedSentence || /[?？]/u.test(strippedSentence)) {
    return undefined
  }

  const withoutTerminalPunctuation = strippedSentence.replace(/[.!。！]+$/u, '').trim()
  if (!withoutTerminalPunctuation) {
    return undefined
  }

  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(withoutTerminalPunctuation)
  const leadingTokenCount = matchLeadingSubordinateClauseSequenceLength(
    tokens.map((token) => token.normalizedText),
  )
  if (
    !leadingTokenCount ||
    tokens.length < leadingTokenCount + 2
  ) {
    return undefined
  }

  if (
    subordinateClauseHasLaterOuterPredicateOrContinuation(
      tokens,
      withoutTerminalPunctuation,
      leadingTokenCount,
    )
  ) {
    return undefined
  }

  return normalizeExplicitTopicOrQuestionUnitText(strippedSentence)
}

function extractSubordinateClauseFragmentAuthoritiesFromText(text: string) {
  const authorities: string[] = []

  for (const sentence of parseTopicSourceResponseSentences(text)) {
    const fragmentAuthority = inferSubordinateClauseFragmentAuthority(sentence.text)
    if (fragmentAuthority) {
      authorities.push(fragmentAuthority)
    }
  }

  return dedupeNonEmptyStrings(authorities)
}

function extractQuestionAuthorityTextsFromText(text: string) {
  const authorities: string[] = []

  for (const sentence of parseTopicSourceResponseSentences(text)) {
    const strippedSentence = stripLeadingQuestionPromptConjunction(sentence.text)
    const strippedTokens = tokenizeEmbeddedMatchingRunSourceResponse(strippedSentence)
    const canonicalQuestionAuthorities: string[] = []
    for (let startTokenIndex = 0; startTokenIndex < strippedTokens.length - 3; startTokenIndex += 1) {
      const match = resolveCanonicalQuestionAnchorMatch(
        strippedSentence,
        strippedTokens,
        startTokenIndex,
      )
      if (match) {
        canonicalQuestionAuthorities.push(match.canonicalPrompt)
      }
    }

    if (canonicalQuestionAuthorities.length > 0) {
      authorities.push(...canonicalQuestionAuthorities)
      continue
    }

    const nonPunctuatedAuthority = inferNonPunctuatedInterrogativeQuestionAuthority(
      sentence.text,
    )
    if (nonPunctuatedAuthority) {
      authorities.push(nonPunctuatedAuthority)
      continue
    }

    if (isQuestionSourceResponseSentence(sentence.text)) {
      const normalizedQuestion = normalizeExplicitQuestionSurfaceText(
        stripLeadingQuestionPromptConjunction(sentence.text),
      )
      if (normalizedQuestion) {
        authorities.push(normalizedQuestion)
      }
    }
  }

  return dedupeNonEmptyStrings(authorities)
}

function assertQuestionAnswerTopicAuthorityMatchesQuestion(
  question: string,
  answer: string,
  unitLabel: string,
) {
  const leadingTextBeforeCanonicalAuthority =
    extractLeadingTextBeforeCanonicalQuestionAuthority(question)
  if (leadingTextBeforeCanonicalAuthority) {
    throw new AnswerInterpretationError(
      `${unitLabel} "${question}" in sourceResponse included leading text "${leadingTextBeforeCanonicalAuthority}" before canonical question authority.`,
    )
  }

  const incompleteQuestionSummary = extractIncompleteLeadingTopicAuthoritySummary(
    stripQuestionBlockLabel(question),
  )
  if (incompleteQuestionSummary) {
    throw new AnswerInterpretationError(
      `${unitLabel} "${question}" in sourceResponse included incomplete topic authority for ${formatQuotedValueList([incompleteQuestionSummary])} inside question text.`,
    )
  }

  const expectedSummary = inferComparableQuestionTopicSummary(question)
  if (!expectedSummary) {
    return
  }

  const answerTopicSummaries = extractExplicitTopicSummariesFromQuestionAnswerText(answer)
  if (answerTopicSummaries.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} "${question}" in sourceResponse included answer text with explicit topic authority for ${formatQuotedValueList(answerTopicSummaries)}.`,
    )
  }

  const incompleteSummaries = extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText(
    answer,
  )
  if (incompleteSummaries.length === 0) {
    return
  }

  throw new AnswerInterpretationError(
    `${unitLabel} "${question}" in sourceResponse included incomplete topic authority for ${formatQuotedValueList(incompleteSummaries)} inside answer text.`,
  )
}

function assertMatchedAnswerTextAuthorityMatchesConsumer(
  answer: string,
  candidates: string[],
  unitLabel: string,
  authorityContainerLabel = 'sourceResponse',
) {
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
    normalizedCandidate: normalizeSourceResponseText(candidate),
    normalizedCandidateCore: normalizeQuestionPromptCore(candidate),
  }))
  if (normalizedCandidates.length === 0) {
    return
  }

  const authorityMatchesCurrentCandidates = (authority: string) => {
    const normalizedAuthority = normalizeSourceResponseText(authority)
    const normalizedAuthorityCore = normalizeQuestionPromptCore(authority)
    if (!normalizedAuthority && !normalizedAuthorityCore) {
      return false
    }

    return normalizedCandidates.some(({ normalizedCandidate, normalizedCandidateCore }) => {
      if (
        normalizedAuthority &&
        topicTextMatchesCandidate(
          normalizedAuthority,
          normalizedCandidate,
          normalizedCandidateCore,
        )
      ) {
        return true
      }
      if (normalizedAuthority && normalizedCandidate.includes(normalizedAuthority)) {
        return true
      }
      if (normalizedAuthority && normalizedCandidateCore.includes(normalizedAuthority)) {
        return true
      }
      if (normalizedAuthorityCore && normalizedCandidateCore.includes(normalizedAuthorityCore)) {
        return true
      }
      return false
    })
  }

  const conflictingQuestionAuthorities = extractQuestionAuthorityTextsFromText(answer)
  if (conflictingQuestionAuthorities.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} in ${authorityContainerLabel} included answer text with question authority ${formatQuotedValueList(conflictingQuestionAuthorities)}.`,
    )
  }

  const subordinateClauseAuthorities = extractSubordinateClauseFragmentAuthoritiesFromText(answer)
  if (subordinateClauseAuthorities.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} in ${authorityContainerLabel} included answer text with subordinate-clause fragment authority ${formatQuotedValueList(subordinateClauseAuthorities)}.`,
    )
  }

  const nestedCurrentTopicSummaries = extractNestedLeadingTopicAuthoritySummariesFromDirectAnswerText(
    answer,
  ).filter((summary) => authorityMatchesCurrentCandidates(summary))
  if (nestedCurrentTopicSummaries.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} in ${authorityContainerLabel} included incomplete topic authority for ${formatQuotedValueList(nestedCurrentTopicSummaries)} inside answer text.`,
    )
  }

  const conflictingTopicSummaries = extractExplicitTopicSummariesFromDirectAnswerText(answer).filter(
    (summary) => !authorityMatchesCurrentCandidates(summary),
  )
  if (conflictingTopicSummaries.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} in ${authorityContainerLabel} included answer text with explicit topic authority for ${formatQuotedValueList(conflictingTopicSummaries)}.`,
    )
  }

  const incompleteSummaries = extractIncompleteLeadingTopicAuthoritySummariesFromDirectAnswerText(
    answer,
  )
  if (incompleteSummaries.length === 0) {
    return
  }

  throw new AnswerInterpretationError(
    `${unitLabel} in ${authorityContainerLabel} included incomplete topic authority for ${formatQuotedValueList(incompleteSummaries)} inside answer text.`,
  )
}

function assertLabeledValueAuthorityMatchesLabel(
  label: string,
  value: string,
  unitLabel: string,
  valueLabel: string,
) {
  const questionAuthorities = extractQuestionAuthorityTextsFromText(value)
  if (questionAuthorities.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} "${label}" in sourceResponse included question authority ${formatQuotedValueList(questionAuthorities)} inside ${valueLabel}.`,
    )
  }

  const expectedSummary = inferComparableExplicitLabelSummary(label)
  if (!expectedSummary) {
    return
  }

  const normalizedExpectedSummary = normalizeSourceResponseLabel(expectedSummary)
  const conflictingSummaries = extractExplicitTopicSummariesFromQuestionAnswerText(value).filter(
    (summary) => normalizeSourceResponseLabel(summary) !== normalizedExpectedSummary,
  )
  if (conflictingSummaries.length === 0) {
    const incompleteSummaries =
      extractIncompleteLeadingTopicAuthoritySummariesFromQuestionAnswerText(value)
    if (incompleteSummaries.length === 0) {
      return
    }

    throw new AnswerInterpretationError(
      `${unitLabel} "${label}" in sourceResponse included incomplete topic authority for ${formatQuotedValueList(incompleteSummaries)} inside ${valueLabel}.`,
    )
  }

  throw new AnswerInterpretationError(
    `${unitLabel} "${label}" in sourceResponse included ${valueLabel} with explicit topic authority for ${formatQuotedValueList(conflictingSummaries)}.`,
  )
}

function assertTopicAnswerTextDoesNotContainQuestionAuthority(text: string, unitLabel: string) {
  const authorities = extractQuestionAuthorityTextsFromText(text)
  if (authorities.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} "${text}" in sourceResponse included question authority ${formatQuotedValueList(authorities)} inside answer text.`,
    )
  }

  const subordinateClauseAuthorities = extractSubordinateClauseFragmentAuthoritiesFromText(text)
  if (subordinateClauseAuthorities.length > 0) {
    throw new AnswerInterpretationError(
      `${unitLabel} "${text}" in sourceResponse included subordinate-clause fragment authority ${formatQuotedValueList(subordinateClauseAuthorities)} inside answer text.`,
    )
  }
}

function stripLeadingQuestionPromptConjunction(question: string) {
  return stripLeadingPresentationListMarkers(question.trim().replace(/^(?:and|but)\s+/i, ''))
}

function normalizeExplicitQuestionSurfaceText(question: string) {
  if (!question) {
    return question
  }

  return `${question.slice(0, 1).toUpperCase()}${question.slice(1)}`
}

function normalizeEmbeddedQuestionAnchorText(question: string) {
  const summary = inferCanonicalQuestionAnchorSummary(question)
  return synthesizeCanonicalPromptFromSummary(summary ?? '') ?? question.trim()
}

function normalizeSourceResponseLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
}

function normalizeSourceResponseText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
}

const QUESTION_CORE_LEADING_TOKENS = new Set([
  'a',
  'an',
  'are',
  'be',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'had',
  'has',
  'have',
  'how',
  'is',
  'need',
  'needed',
  'needs',
  'our',
  'should',
  'the',
  'to',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'whom',
  'whose',
  'why',
  'will',
  'would',
])

const QUESTION_KEYWORD_STOPWORDS = new Set([
  ...QUESTION_CORE_LEADING_TOKENS,
  'all',
  'and',
  'as',
  'at',
  'by',
  'if',
  'in',
  'into',
  'it',
  'its',
  'of',
  'on',
  'or',
  'than',
  'then',
  'through',
  'via',
  'with',
])

const EMBEDDED_CANONICAL_QUESTION_SUBJECT_LEADING_TOKENS = new Set([
  'a',
  'an',
  'her',
  'his',
  'its',
  'my',
  'our',
  'that',
  'the',
  'their',
  'these',
  'this',
  'those',
  'your',
])

const EMBEDDED_CANONICAL_QUESTION_SUBJECT_REJECT_TOKENS = new Set([
  ...QUESTION_KEYWORD_STOPWORDS,
  'be',
])

function normalizeQuestionPromptCore(value: string) {
  const normalized = normalizeSourceResponseText(value)
  if (!normalized) {
    return ''
  }

  const tokens = normalized.split(' ').filter(Boolean)
  let startIndex = 0
  while (startIndex < tokens.length && QUESTION_CORE_LEADING_TOKENS.has(tokens[startIndex] ?? '')) {
    startIndex += 1
  }

  return tokens.slice(startIndex).join(' ')
}

function inferCanonicalQuestionAnchorSummary(question: string) {
  const trimmed = stripCanonicalQuestionAnchorLabel(question)
  if (!trimmed) {
    return undefined
  }

  const subject = /^what should\s+(?<subject>.+?)\s+be$/i.exec(trimmed)?.groups?.subject
  if (!subject) {
    return undefined
  }

  return normalizeExtractedTopicSummary(subject, true)
}

function stripCanonicalQuestionAnchorLabel(question: string) {
  return stripLeadingQuestionPromptConjunction(question)
    .replace(/[?？.!。！]+$/u, '')
    .trim()
}

function extractLeadingTextBeforeCanonicalQuestionAuthority(question: string) {
  const trimmed = question.trim()
  if (!trimmed) {
    return undefined
  }

  const tokens = tokenizeEmbeddedMatchingRunSourceResponse(trimmed)
  for (let startTokenIndex = 0; startTokenIndex < tokens.length - 3; startTokenIndex += 1) {
    const match = resolveCanonicalQuestionAnchorMatch(trimmed, tokens, startTokenIndex)
    if (!match) {
      continue
    }

    const prefix = trimmed.slice(0, tokens[startTokenIndex]?.start ?? 0).trim()
    if (!prefix) {
      return undefined
    }

    const normalizedPrefix = stripLeadingPresentationListMarkers(prefix)
      .replace(/^(?:and|but)\b[\s,;:.\-–—―]*/i, '')
      .trim()
    return normalizedPrefix || undefined
  }

  return undefined
}

function resolveCanonicalQuestionAnchorMatch(
  sourceResponse: string,
  tokens: EmbeddedMatchingRunToken[],
  startTokenIndex: number,
): CanonicalQuestionAnchorMatch | undefined {
  if (
    tokens[startTokenIndex]?.normalizedText !== 'what' ||
    tokens[startTokenIndex + 1]?.normalizedText !== 'should'
  ) {
    return undefined
  }

  const maxEndTokenIndex = Math.min(tokens.length, startTokenIndex + 10)
  for (let endTokenIndex = startTokenIndex + 3; endTokenIndex < maxEndTokenIndex; endTokenIndex += 1) {
    if (tokens[endTokenIndex]?.normalizedText !== 'be') {
      continue
    }

    const subjectLeadingToken = tokens[startTokenIndex + 2]?.normalizedText
    const subjectStartTokenIndex = EMBEDDED_CANONICAL_QUESTION_SUBJECT_LEADING_TOKENS.has(
      subjectLeadingToken ?? '',
    )
      ? startTokenIndex + 3
      : startTokenIndex + 2
    if (subjectStartTokenIndex >= endTokenIndex) {
      continue
    }

    const subjectTokens = tokens
      .slice(subjectStartTokenIndex, endTokenIndex)
      .map((token) => token.normalizedText)
    if (
      subjectTokens.length === 0 ||
      subjectTokens.some((token) => EMBEDDED_CANONICAL_QUESTION_SUBJECT_REJECT_TOKENS.has(token))
    ) {
      continue
    }

    const endOriginal = tokens[endTokenIndex]?.end ?? sourceResponse.length
    const rawQuestion = sourceResponse.slice(tokens[startTokenIndex]?.start ?? 0, endOriginal).trim()
    const canonicalPrompt = normalizeEmbeddedQuestionAnchorText(rawQuestion)
    if (canonicalPrompt === rawQuestion) {
      continue
    }

    return {
      rawQuestion,
      canonicalPrompt,
      endTokenIndex,
      endOriginal,
    }
  }

  return undefined
}

function inlineTopicClauseUsesExplicitTopicAuthority(trimmedClause: string) {
  if (!trimmedClause) {
    return false
  }

  if (/^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/u.test(trimmedClause)) {
    return false
  }

  if (/^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/u.test(trimmedClause)) {
    return false
  }

  return dedupeNonEmptyStrings(extractInferredTopicSummaries(trimmedClause)).length === 1
}

function autoInlineTopicsShouldYieldToExplicitTopicAuthority(
  sourceResponseState: InterpretedSourceResponseState | undefined,
) {
  const sourceResponse = sourceResponseState?.sourceResponse?.trim()
  if (!sourceResponse) {
    return false
  }

  let parsedClauseCount = 0
  for (const clause of splitInlineTopicClauses(sourceResponse)) {
    const parsed = parseInlineTopicClause(clause)
    if (!parsed) {
      continue
    }

    parsedClauseCount += 1
    const trimmedClause = stripLeadingPresentationListMarkers(
      clause.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (!inlineTopicClauseUsesExplicitTopicAuthority(trimmedClause)) {
      return false
    }
  }

  return parsedClauseCount > 0
}

function autoInlineTopicsShouldYieldIncompleteTopicAuthorityToClauseTopics(
  sourceResponseState: InterpretedSourceResponseState | undefined,
) {
  const sourceResponse = sourceResponseState?.sourceResponse?.trim()
  if (!sourceResponse) {
    return false
  }

  let parsedVerbalInlineClauseCount = 0
  for (const clause of splitInlineTopicClauses(sourceResponse)) {
    const parsed = parseInlineTopicClause(clause)
    if (!parsed) {
      continue
    }

    const trimmedClause = stripLeadingPresentationListMarkers(
      clause.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (inlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause)) {
      return false
    }
    parsedVerbalInlineClauseCount += 1
  }

  if (parsedVerbalInlineClauseCount === 0) {
    return false
  }

  const clauses = parseTopicSourceResponseClauses(sourceResponse)
  if (clauses.length <= 1) {
    return false
  }

  const clauseTopicAuthorityCount = clauses.filter(
    (clause) =>
      extractInferredTopicSummaries(clause.text).length > 0 ||
      textHasIncompleteLeadingTopicAuthority(clause.text),
  ).length

  return clauseTopicAuthorityCount > 1
}

function filterEmbeddedQuestionCandidateGroups(candidateGroups: string[][]) {
  return candidateGroups.flatMap((candidateGroup) => {
    const filteredGroup = dedupeNonEmptyStrings(candidateGroup.filter(isEmbeddedQuestionCandidate))
    return filteredGroup.length > 0 ? [filteredGroup] : []
  })
}

function isEmbeddedQuestionCandidate(candidate: string) {
  const trimmed = candidate.trim()
  if (!trimmed) {
    return false
  }
  if (/[?？]/u.test(trimmed)) {
    return true
  }

  const normalized = normalizeSourceResponseText(trimmed)
  return /^(?:what|which|who|whom|whose|why|where|when|how)\b/.test(normalized)
}

function inferEmbeddedCanonicalQuestionCandidateGroups(
  sourceResponse: string,
  tokens: EmbeddedMatchingRunToken[],
) {
  const groups: string[][] = []

  for (let startTokenIndex = 0; startTokenIndex < tokens.length - 3; startTokenIndex += 1) {
    const match = resolveCanonicalQuestionAnchorMatch(sourceResponse, tokens, startTokenIndex)
    if (!match) {
      continue
    }

    groups.push(dedupeNonEmptyStrings([match.rawQuestion, match.canonicalPrompt]))
  }

  return groups
}

function normalizedTopicLabelContainsLabel(
  normalizedCandidateLabel: string,
  normalizedContainedLabel: string,
) {
  return ` ${normalizedCandidateLabel} `.includes(` ${normalizedContainedLabel} `)
}

function extractQuestionPromptKeywordAnchors(normalizedText: string) {
  const anchors = new Set<string>()
  for (const token of normalizedText.split(' ')) {
    if (!token || QUESTION_KEYWORD_STOPWORDS.has(token)) {
      continue
    }
    anchors.add(token)
  }
  return [...anchors]
}

function keywordAnchorSetsMatch(normalizedQuestionText: string, normalizedCandidate: string) {
  const questionAnchors = extractQuestionPromptKeywordAnchors(normalizedQuestionText)
  const candidateAnchors = extractQuestionPromptKeywordAnchors(normalizedCandidate)
  if (questionAnchors.length < 2 || candidateAnchors.length < 2) {
    return false
  }

  const questionAnchorSet = new Set(questionAnchors)
  const candidateAnchorSet = new Set(candidateAnchors)
  return (
    questionAnchors.every((anchor) => candidateAnchorSet.has(anchor)) ||
    candidateAnchors.every((anchor) => questionAnchorSet.has(anchor))
  )
}

function questionTextMatchesCandidate(
  normalizedQuestionText: string,
  normalizedQuestionCoreText: string,
  normalizedCandidate: string,
  normalizedCandidateCore: string,
) {
  if (` ${normalizedQuestionText} `.includes(` ${normalizedCandidate} `)) {
    return true
  }
  if (!normalizedQuestionCoreText || !normalizedCandidateCore) {
    return false
  }
  if (normalizedQuestionCoreText === normalizedCandidateCore) {
    return true
  }
  return (
    ` ${normalizedQuestionCoreText} `.includes(` ${normalizedCandidateCore} `) ||
    ` ${normalizedCandidateCore} `.includes(` ${normalizedQuestionCoreText} `) ||
    keywordAnchorSetsMatch(normalizedQuestionText, normalizedCandidate)
  )
}

function topicTextMatchesCandidate(
  normalizedText: string,
  normalizedCandidate: string,
  normalizedCandidateCore: string,
) {
  if (` ${normalizedText} `.includes(` ${normalizedCandidate} `)) {
    return true
  }
  if (normalizedCandidateCore && ` ${normalizedText} `.includes(` ${normalizedCandidateCore} `)) {
    return true
  }
  return keywordAnchorSetsMatch(normalizedText, normalizedCandidate)
}

function resolveSingleTopicAnchorLabel(
  text: string,
  matchingLabels: string[],
  multipleMatchMessage: string,
  inferLabels: (text: string) => string[],
) {
  if (matchingLabels.length > 1) {
    throw new AnswerInterpretationError(multipleMatchMessage)
  }

  const inferredLabels = dedupeNonEmptyStrings(inferLabels(text))
  if (inferredLabels.length > 1) {
    throw new AnswerInterpretationError(multipleMatchMessage)
  }

  return matchingLabels[0] ?? inferredLabels[0]
}

function inferTopicSpanAnchorLabelsFromSentence(sentence: string) {
  return inferNormalizedTopicAnchorLabelsFromText(sentence)
}

function inferTopicClosingSpanLabelsFromSentence(sentence: string) {
  return inferNormalizedTopicAnchorLabelsFromText(sentence)
}

function inferTopicClosingBlockLabelsFromParagraph(paragraph: string) {
  return inferNormalizedTopicAnchorLabelsFromText(paragraph)
}

function inferTopicBlockAnchorLabelsFromParagraph(paragraph: string) {
  return inferNormalizedTopicAnchorLabelsFromText(paragraph)
}

function inferNormalizedTopicAnchorLabelsFromText(text: string) {
  return extractTopicAnchorCandidateSummariesFromText(text)
    .map((summary) => normalizeSourceResponseLabel(summary))
    .filter(Boolean)
}

function inferTopicSummaryFromTopicSentence(sentence: string) {
  assertTopicTextHasSubstantiveLeadingAnswerContent(sentence, 'topic sentence')
  const summaries = extractTopicAnchorCandidateSummariesFromText(sentence)
  if (summaries.length === 0) {
    throw new AnswerInterpretationError(
      `Could not infer a decision summary from topic sentence "${sentence}".`,
    )
  }
  if (summaries.length > 1) {
    throw new AnswerInterpretationError(
      `Multiple decision summaries were inferred from topic sentence "${sentence}".`,
    )
  }
  return summaries[0] as string
}

function inferTopicSummaryFromTopicParagraph(paragraph: string) {
  assertTopicTextHasSubstantiveLeadingAnswerContent(paragraph, 'topic paragraph')
  const summaries = extractTopicAnchorCandidateSummariesFromParagraphText(paragraph)
  if (summaries.length === 0) {
    throw new AnswerInterpretationError(
      `Could not infer a decision summary from topic paragraph "${paragraph}".`,
    )
  }
  if (summaries.length > 1) {
    throw new AnswerInterpretationError(
      `Multiple decision summaries were inferred from topic paragraph "${paragraph}".`,
    )
  }
  return summaries[0] as string
}

function extractTopicAnchorCandidateSummariesFromText(text: string) {
  const conjunctionSegments = parsePendingSourceResponseConjunctions(text)
  if (conjunctionSegments.length <= 1) {
    return extractInferredTopicSummaries(text)
  }

  return dedupeNonEmptyStrings(
    conjunctionSegments.flatMap((segment) => extractInferredTopicSummaries(segment)),
  )
}

function extractTopicAnchorCandidateSummariesFromParagraphText(text: string) {
  return dedupeNonEmptyStrings(
    [
      ...extractTopicAnchorCandidateSummariesFromText(text),
      ...parseTopicSourceResponseClauses(text).flatMap((clause) =>
        extractTopicAnchorCandidateSummariesFromText(clause.text),
      ),
    ],
  )
}

function paragraphTextImpliesMultipleTopicSummaries(text: string) {
  return extractTopicAnchorCandidateSummariesFromParagraphText(text).length > 1
}

function inferTopicSummaryFromTopicSpan(span: TopicSourceResponseSpan) {
  return inferTopicSummaryFromTopicSentence(span.anchorText)
}

function inferTopicSummaryFromTopicClosingSpan(span: TopicSourceResponseClosingSpan) {
  return inferTopicSummaryFromTopicSentence(span.closingText)
}

function inferTopicSummaryFromTopicClosingBlock(block: TopicSourceResponseClosingBlock) {
  return inferTopicSummaryFromTopicParagraph(block.closingText)
}

function inferTopicSummaryFromTopicBlock(block: TopicSourceResponseBlock) {
  return inferTopicSummaryFromTopicParagraph(block.anchorText)
}

function normalizeExtractedTopicSummary(summary: string, stripLeadingArticle = false) {
  const normalizedSummary = summary
    .trim()
    .replace(stripLeadingArticle ? /^(?:the|a|an)\s+/i : /^$/u, '')
    .replace(/\s+/g, ' ')
  if (!normalizedSummary) {
    return undefined
  }

  const normalized = normalizeSourceResponseLabel(normalizedSummary)
  if (!normalized) {
    return undefined
  }

  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length === 0 || tokens.length > 6) {
    return undefined
  }
  const firstToken = tokens[0]
  if (
    (firstToken && LEADING_TOPIC_SUMMARY_REJECT_TOKENS.has(firstToken)) ||
    startsWithMultiTokenSubordinateClauseSequence(tokens)
  ) {
    return undefined
  }

  return `${normalizedSummary.slice(0, 1).toUpperCase()}${normalizedSummary.slice(1)}`
}

const EXTRACTABLE_TOPIC_SUMMARY_PATTERN = "[A-Za-z0-9][A-Za-z0-9 &'’/_-]*?"

function extractTrailingTopicSummary(text: string) {
  const trimmed = text.trim()
  if (!trimmed || startsWithNonPunctuatedWhClauseDeclarative(trimmed)) {
    return undefined
  }

  const normalized = normalizeSourceResponseLabel(trimmed)
  if (normalized) {
    const tokens = normalized.split(' ').filter(Boolean)
    if (matchLeadingSubordinateClauseSequenceLength(tokens) !== undefined) {
      return undefined
    }
  }

  const match = new RegExp(
    `\\bfor\\s+(?!(?:the|a|an)\\b)(?<summary>${EXTRACTABLE_TOPIC_SUMMARY_PATTERN})\\s*[,.;?!，；。？！]?$`,
    'i',
  ).exec(trimmed)?.groups?.summary
  if (!match) {
    return undefined
  }

  return normalizeExtractedTopicSummary(match)
}

function inferSummaryFromStablePrompt(prompt: string | undefined) {
  const trimmed = prompt?.trim()
  if (!trimmed) {
    return undefined
  }

  const canonicalSummary = inferCanonicalQuestionAnchorSummary(trimmed)
  if (!canonicalSummary) {
    return synthesizeCanonicalPromptFromSummary(trimmed) === trimmed ? trimmed : undefined
  }

  return canonicalSummary
}

function inferSummaryFromStableMatchHints(matchHints: string[] | undefined) {
  const hints = dedupeNonEmptyStrings(matchHints ?? [])
  if (hints.length !== 1) {
    return undefined
  }

  const onlyHint = hints[0]
  if (!onlyHint) {
    return undefined
  }

  return (
    normalizeExtractedTopicSummary(onlyHint, true) ||
    (synthesizeCanonicalPromptFromSummary(onlyHint) === onlyHint ? onlyHint : undefined)
  )
}

function hasMultipleStableMatchHints(matchHints: string[] | undefined) {
  return dedupeNonEmptyStrings(matchHints ?? []).length > 1
}

function inferSummaryFromStableSummaryKey(summaryKey: string | undefined) {
  const humanized = humanizeSummaryKey(summaryKey)
  if (!humanized) {
    return undefined
  }

  return normalizeExtractedTopicSummary(humanized, true)
}

function inferSummaryFromDecisionKey(decisionKey: string | undefined) {
  const humanized = humanizeDecisionKey(decisionKey)
  if (!humanized) {
    return undefined
  }

  return normalizeExtractedTopicSummary(humanized, true)
}

function inferSummaryFromStableAnswerSourceKey(key: string | undefined) {
  const trimmed = key?.trim()
  if (!trimmed) {
    return undefined
  }

  const humanizedWithSuffix = trimmed.replace(/[_-]+/g, ' ')
  const humanized = humanizeAnswerSourceKey(trimmed)
  if (!humanized || humanized === humanizedWithSuffix) {
    return undefined
  }

  return normalizeExtractedTopicSummary(humanized, true)
}

function inferSummaryKeyFromStableAnswerSourceKey(key: string | undefined) {
  const trimmed = key?.trim()
  if (!trimmed) {
    return undefined
  }

  const stripped = trimmed.replace(/(?:[_-]+(?:answer|source))$/i, '')
  if (!stripped || stripped === trimmed) {
    return undefined
  }

  const normalized = stripped
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

  return normalized || undefined
}

function shouldDeriveSummaryKeyFromAnswerSourceKey(entry: ResolvedAnswerSourceEntry) {
  if (entry.summary?.trim()) {
    return false
  }
  if (inferSummaryFromStablePrompt(entry.prompt)) {
    return false
  }
  if (entry.summaryKey?.trim()) {
    return false
  }
  if (inferSummaryFromStableMatchHints(entry.matchHints)) {
    return false
  }
  return !hasMultipleStableMatchHints(entry.matchHints)
}

function extractPrefixedTopicSummary(text: string) {
  const trimmed = stripLeadingTopicPromptConjunction(text)
  if (!trimmed) {
    return undefined
  }

  const normalized = normalizeSourceResponseLabel(trimmed)
  if (normalized) {
    const tokens = normalized.split(' ').filter(Boolean)
    if (startsWithMultiTokenSubordinateClauseSequence(tokens)) {
      return undefined
    }
  }

  const summary = new RegExp(
    `^(?:${TOPIC_SUMMARY_PREFIX_PATTERN})\\s+(?<summary>${EXTRACTABLE_TOPIC_SUMMARY_PATTERN})\\s*(?:,|:|-|，|：|－)\\s+.+$`,
    'i',
  ).exec(trimmed)?.groups?.summary
  if (!summary) {
    return undefined
  }

  return normalizeExtractedTopicSummary(summary, true)
}

function extractAsTopicSummary(text: string) {
  const trimmed = text.trim()
  if (!trimmed || startsWithNonPunctuatedWhClauseDeclarative(trimmed)) {
    return undefined
  }

  const summary = new RegExp(
    `\\bas\\s+(?:the|a|an)\\s+(?<summary>${EXTRACTABLE_TOPIC_SUMMARY_PATTERN})\\s*[.?!。？！]?$`,
    'i',
  ).exec(trimmed)?.groups?.summary
  if (!summary) {
    return undefined
  }

  return normalizeExtractedTopicSummary(summary)
}

function extractCopularTopicSummary(text: string) {
  const trimmed = stripLeadingTopicPromptConjunction(text)
  if (!trimmed || startsWithNonPunctuatedWhClauseDeclarative(trimmed)) {
    return undefined
  }

  const summary = new RegExp(
    `^(?:.+?)\\s+(?:should\\s+be|will\\s+be|must\\s+be|can\\s+be|could\\s+be|would\\s+be|is|are|was|were|serves?\\s+as|served\\s+as|acts?\\s+as|acted\\s+as|functions?\\s+as|functioned\\s+as|remain|remains|remained)\\s+(?:the|a|an|our|your|their)\\s+(?<summary>${EXTRACTABLE_TOPIC_SUMMARY_PATTERN})\\s*[.?!。？！]?$`,
    'i',
  ).exec(trimmed)?.groups?.summary
  if (!summary) {
    return undefined
  }

  return normalizeExtractedTopicSummary(summary)
}

const LEADING_TOPIC_SUMMARY_REJECT_TOKENS = new Set([
  'about',
  ...SUBORDINATE_CLAUSE_LEADING_WORDS,
  ...QUESTION_CORE_LEADING_TOKENS,
  'he',
  'her',
  'here',
  'him',
  'i',
  'it',
  'me',
  'my',
  'now',
  'she',
  'that',
  'their',
  'them',
  'there',
  'these',
  'they',
  'this',
  'those',
  'us',
  'we',
  'you',
  'your',
  'regarding',
])

function extractLeadingTopicSummary(text: string) {
  const trimmed = stripLeadingTopicPromptConjunction(text)
  if (!trimmed) {
    return undefined
  }

  const label = matchLeadingTopicAuthority(trimmed)?.label
  if (!label) {
    return undefined
  }

  return normalizeExtractedTopicSummary(label, true)
}

function matchLeadingTopicAuthority(text: string) {
  return new RegExp(
    `^(?<label>.+?)\\s+(?<answer>${TOPIC_SUMMARY_VERB_PATTERN}\\b.+)$`,
    'i',
  ).exec(text)?.groups
}

function topicPredicateIncludesSubstantiveAnswerContent(answer: string) {
  const stripped = answer
    .trim()
    .replace(new RegExp(`^(?:${TOPIC_SUMMARY_VERB_PATTERN})\\b\\s*`, 'i'), '')
    .replace(
      /^(?:(?:be|been|being|use|uses|means|requires|starts|with|as|the|a|an|our|your|their)\b\s*)+/i,
      '',
    )
    .replace(/^[\p{P}\p{S}\s]+/gu, '')
    .trim()

  return /[\p{L}\p{N}]/u.test(stripped)
}

function textHasIncompleteLeadingTopicAuthority(text: string) {
  const trimmed = stripLeadingTopicPromptConjunction(text)
  if (!trimmed) {
    return false
  }

  const answer = matchLeadingTopicAuthority(trimmed)?.answer
  return answer !== undefined && !topicPredicateIncludesSubstantiveAnswerContent(answer)
}

function assertTopicTextHasSubstantiveLeadingAnswerContent(text: string, unitLabel: string) {
  if (!textHasIncompleteLeadingTopicAuthority(text)) {
    return
  }

  throw new AnswerInterpretationError(
    `${unitLabel.slice(0, 1).toUpperCase()}${unitLabel.slice(1)} "${text}" in sourceResponse did not include answer text after the topic anchor.`,
  )
}

function stripLeadingTopicPromptConjunction(text: string) {
  return stripLeadingPresentationListMarkers(text.trim().replace(/^(?:and|but)\s+/i, ''))
}

function extractInferredTopicSummaries(text: string) {
  const prefixed = extractPrefixedTopicSummary(text)
  const asTopic = extractAsTopicSummary(text)
  const copular = extractCopularTopicSummary(text)
  const leading = copular ? undefined : extractLeadingTopicSummary(text)
  const trailing = extractTrailingTopicSummary(text)

  return dedupeNonEmptyStrings([prefixed, asTopic, copular, leading, trailing])
}

function humanizeDecisionKey(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/[_-]+/g, ' ') : undefined
}

function humanizeSummaryKey(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/[_-]+/g, ' ') : undefined
}

function humanizePlanningAnswerKey(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/[_-]+/g, ' ') : undefined
}

function humanizeAnswerSourceKey(value: string | undefined) {
  const trimmed = value?.trim()
  const humanized = trimmed ? trimmed.replace(/[_-]+/g, ' ') : undefined
  if (!humanized) {
    return undefined
  }
  return humanized.replace(/\s+(?:answer|source)$/i, '')
}

function buildKnownDecisionSourceResponseCandidates(decision: InterpretableKnownDecision) {
  return dedupeNonEmptyStrings([
    humanizeSummaryKey(decision.summaryKey),
    humanizeDecisionKey(decision.decisionKey),
    decision.summary,
    decision.prompt,
    ...(decision.matchHints ?? []),
  ])
}

function buildMatchingRunCandidateGroupKey(candidates: string[]) {
  return dedupeNonEmptyStrings(candidates)
    .map((candidate) => normalizeSourceResponseLabel(candidate))
    .filter(Boolean)
    .sort()
    .join('|')
}

function dedupeNonEmptyStrings(values: Array<string | undefined>) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const trimmed = value?.trim()
    if (!trimmed) {
      continue
    }
    const normalized = normalizeSourceResponseLabel(trimmed)
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    result.push(trimmed)
  }
  return result
}

function findMatchingAnswerSourceEntryIndexes(
  entries: ResolvedAnswerSourceEntry[],
  candidates: string[],
  consumedIndexes: Set<number>,
  consumerFamily?: RemainingAnswerSourceRoute,
) {
  const normalizedCandidates = new Set(
    candidates.map((candidate) => normalizeSourceResponseLabel(candidate)).filter(Boolean),
  )
  return entries.flatMap((entry, index) => {
    if (consumedIndexes.has(index)) {
      return []
    }
    if (consumerFamily && entry.route && entry.route !== consumerFamily) {
      return []
    }
    const hasMatch = entry.candidates.some((candidate) =>
      normalizedCandidates.has(normalizeSourceResponseLabel(candidate)),
    )
    return hasMatch ? [index] : []
  })
}

function createResolvedAnswerSources(
  answerSources: InterpretableAnswerSource[] | undefined,
  sourceResponse: string | undefined,
) {
  if (!answerSources || answerSources.length === 0) {
    return undefined
  }

  const answerSourcesByKey = new Map<string, string>()
  const answerSourceGroupsByKey = new Map<string, string>()
  const entries: ResolvedAnswerSourceEntry[] = []
  const groupedEntryIndexBySourceGroupKey = new Map<string, number>()
  for (const source of answerSources) {
    const key = source.answerSourceKey.trim()
    if (answerSourcesByKey.has(key)) {
      throw new AnswerInterpretationError(`Duplicate answerSourceKey: ${key}`)
    }
    let resolved: string
    if ('answer' in source) {
      resolved = source.answer.trim()
    } else {
      resolved = resolveSourceExcerpt(
        source.sourceExcerpt,
        source.sourceOccurrence,
        sourceResponse,
        `answerSourceKey "${key}"`,
      ) as string
    }
    const decisionKey = source.decisionKey?.trim() || undefined
    const summaryKey = source.summaryKey?.trim() || undefined
    const answerKey = source.answerKey?.trim() || undefined
    const sourceGroupKey = source.sourceGroupKey?.trim() || undefined
    const route = source.route
    const summary = source.summary?.trim() || undefined
    const prompt = source.prompt?.trim() || undefined
    const matchHints = dedupeNonEmptyStrings(source.matchHints ?? [])
    answerSourcesByKey.set(key, resolved)
    const entry: ResolvedAnswerSourceEntry = {
      key: sourceGroupKey ?? key,
      sourceKeys: [key],
      sourceGroupKey,
      answer: resolved,
      route,
      decisionKey,
      answerKey,
      summaryKey,
      summary,
      prompt,
      ...(matchHints.length ? { matchHints } : {}),
      candidates: buildAnswerSourceResponseCandidates(source),
    }
    if (!sourceGroupKey) {
      entries.push(entry)
      continue
    }
    const existingIndex = groupedEntryIndexBySourceGroupKey.get(sourceGroupKey)
    if (existingIndex === undefined) {
      groupedEntryIndexBySourceGroupKey.set(sourceGroupKey, entries.length)
      entries.push(entry)
      answerSourceGroupsByKey.set(sourceGroupKey, resolved)
      continue
    }
    const existingEntry = entries[existingIndex]
    if (!existingEntry) {
      throw new AnswerInterpretationError(
        `Missing grouped answerSource entry for sourceGroupKey "${sourceGroupKey}".`,
      )
    }
    const mergedEntry = mergeAnswerSourceEntries(
      [existingEntry, entry],
      `sourceGroupKey "${sourceGroupKey}"`,
    )
    entries[existingIndex] = mergedEntry
    answerSourceGroupsByKey.set(sourceGroupKey, mergedEntry.answer)
  }
  return {
    byKey: answerSourcesByKey,
    byGroupKey: answerSourceGroupsByKey,
    entries,
  } satisfies ResolvedAnswerSources
}
