import { synthesizeCanonicalPromptFromSummary } from '../domain/canonicalPrompt'
import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
} from '../storage/planningRequestStore'
import type { GoalPlanningBatchEntryInput } from './planningRequest'

export class AnswerInterpretationError extends Error {}
class AutoSourceResponseTerminalError extends AnswerInterpretationError {}

export const INTERPRETABLE_SOURCE_RESPONSE_FORMATS = [
  'auto',
  'labeled_sections',
  'single_pending',
  'pending_clauses',
  'pending_paragraphs',
  'pending_sentences',
  'pending_conjunctions',
  'pending_answer_sources',
  'matching_answer_sources',
  'matching_runs',
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
] as const

export type InterpretableSourceResponseFormat =
  (typeof INTERPRETABLE_SOURCE_RESPONSE_FORMATS)[number]

type ConcreteInterpretableSourceResponseFormat = Exclude<InterpretableSourceResponseFormat, 'auto'>

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

interface ResolvedAnswerContent {
  answer: string
  prompt?: string
}

interface ResolvedAnswerSourceEntry {
  key: string
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
  'inline_topics',
  'question_blocks',
  'question_closing_blocks',
  'question_middle_blocks',
  'question_spans',
  'question_middle_spans',
  'question_closing_spans',
  'question_clauses',
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

  return AUTO_SOURCE_RESPONSE_FORMAT_PRIORITY.filter((format) => {
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
    return (sourceResponseState?.inlineTopics?.size ?? 0) > 1
  }
  if (sourceResponseFormat === 'question_blocks') {
    return (sourceResponseState?.consumedQuestionBlockIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'question_clauses') {
    return (sourceResponseState?.consumedQuestionClauseIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'question_spans') {
    return (sourceResponseState?.consumedQuestionSpanIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'question_middle_spans') {
    return (sourceResponseState?.consumedQuestionMiddleSpanIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'question_closing_spans') {
    return (sourceResponseState?.consumedQuestionClosingSpanIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'question_closing_blocks') {
    return (sourceResponseState?.consumedQuestionClosingBlockIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'question_middle_blocks') {
    return (sourceResponseState?.consumedQuestionMiddleBlockIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'topic_clauses') {
    return (sourceResponseState?.consumedTopicClauseIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'topic_sentences') {
    return (sourceResponseState?.consumedTopicSentenceIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'topic_spans') {
    return (sourceResponseState?.consumedTopicSpanIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'topic_middle_spans') {
    return (sourceResponseState?.consumedTopicMiddleSpanIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'topic_closing_spans') {
    return (sourceResponseState?.consumedTopicClosingSpanIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'topic_closing_blocks') {
    return (sourceResponseState?.consumedTopicClosingBlockIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'topic_paragraphs') {
    return (sourceResponseState?.consumedTopicParagraphIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'topic_middle_blocks') {
    return (sourceResponseState?.consumedTopicMiddleBlockIndexes.size ?? 0) > 0
  }
  if (sourceResponseFormat === 'topic_blocks') {
    return (sourceResponseState?.consumedTopicBlockIndexes.size ?? 0) > 0
  }
  return false
}

export function materializeInterpretedDecisionAnswers(
  answers: InterpretableDecisionAnswerEntryInput[],
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
  additionalSourceResponseCandidates: string[][] = [],
): MaterializedInterpretedDecisionAnswer[] {
  const resolvedAnswerSources = createResolvedAnswerSources(answerSources, sourceResponse)
  const answerSourcesByKey = resolvedAnswerSources?.byKey
  const pendingAnswerSourceEntries = resolvedAnswerSources?.entries
  const matchingAnswerSourceEntries = resolvedAnswerSources?.entries
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  registerTopicAnchorCandidates(interpretationState, [
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
      sourceResponse,
      `decision answer ${answer.decisionKey ?? answer.summary}`,
      answerSourcesByKey,
      pendingAnswerSourceEntries,
      matchingAnswerSourceEntries,
      sourceResponseFormat,
      buildDecisionAnswerSourceResponseCandidates(answer),
      interpretationState,
      buildDecisionPendingAnswerSourceConsumerDescriptor(answer),
    )
    return {
      summary: answer.summary,
      ...(answer.summaryKey?.trim() ? { summaryKey: answer.summaryKey.trim() } : {}),
      prompt: answer.prompt?.trim() || resolved.prompt,
      matchHints: answer.matchHints,
      decisionKey: answer.decisionKey,
      taskRef: answer.taskRef,
      answer: resolved.answer,
    }
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
    throw new AnswerInterpretationError(
      'No decision answers were materialized. Provide explicit answers or use inferOpenDecisions with structured sourceResponse items that match at least one open decision.',
    )
  }

  return materializedAnswers
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
    }),
    (candidateFormat) => {
      const state = createInterpretedSourceResponseState(input.sourceResponse, candidateFormat)
      const mixedRemainingAnswerSourceInference = hasMixedRemainingAnswerSourceInference(input)
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
          )
        }
        assertAutoSourceResponseFormatCompleteness({
          sourceResponse: input.sourceResponse,
          answerSources: input.answerSources,
          sourceResponseFormat: candidateFormat,
          sourceResponseState: state,
          inferDecisionTopics: input.inferDecisionTopics ?? false,
          inferRemainingAnswers: followThroughInfersRemainingAnswers(input.followThrough),
        })
      } catch (error) {
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
  )
  assertNoUnusedExplicitlyRoutedAnswerSources({
    sourceResponse: input.sourceResponse,
    answerSources: input.answerSources,
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
) {
  if (!followThrough) {
    return undefined
  }
  const resolvedAnswerSources = createResolvedAnswerSources(answerSources, sourceResponse)
  const answerSourcesByKey = resolvedAnswerSources?.byKey
  const pendingAnswerSourceEntries = resolvedAnswerSources?.entries
  const matchingAnswerSourceEntries = resolvedAnswerSources?.entries
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  registerTopicAnchorCandidates(interpretationState, [
    ...listInterpretableFollowThroughAnswerCandidateGroups(followThrough),
  ])

  if (followThrough.kind === 'planning') {
    return {
      ...followThrough,
      answers: materializeInterpretedPlanningAnswers(
        followThrough.answers,
        sourceResponse,
        answerSourcesByKey,
        pendingAnswerSourceEntries,
        matchingAnswerSourceEntries,
        sourceResponseFormat,
        interpretationState,
        followThrough.inferRemainingAnswers ?? false,
      ),
    }
  }

  if (followThrough.kind === 'planning_batch') {
    return {
      ...followThrough,
      answers: materializeInterpretedPlanningAnswers(
        followThrough.answers,
        sourceResponse,
        answerSourcesByKey,
        pendingAnswerSourceEntries,
        matchingAnswerSourceEntries,
        sourceResponseFormat,
        interpretationState,
        followThrough.inferRemainingAnswers ?? false,
      ),
    }
  }

  const rootSharedAnswers = materializeInterpretedPlanningAnswers(
    followThrough.answers,
    sourceResponse,
    answerSourcesByKey,
    pendingAnswerSourceEntries,
    matchingAnswerSourceEntries,
    sourceResponseFormat,
    interpretationState,
  )

  const workflows = followThrough.workflows.map((workflow) => {
    if (workflow.kind === 'planning') {
      return {
        ...workflow,
        answers: materializeInterpretedPlanningAnswers(
          workflow.answers,
          sourceResponse,
          answerSourcesByKey,
          pendingAnswerSourceEntries,
          matchingAnswerSourceEntries,
          sourceResponseFormat,
          interpretationState,
        ),
      }
    }

    return {
      ...workflow,
      answers: materializeInterpretedPlanningAnswers(
        workflow.answers,
        sourceResponse,
        answerSourcesByKey,
        pendingAnswerSourceEntries,
        matchingAnswerSourceEntries,
        sourceResponseFormat,
        interpretationState,
      ),
    }
  })

  return {
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
    }),
    (candidateFormat) => {
      const state = createInterpretedSourceResponseState(sourceResponse, candidateFormat)
      try {
        materializeInterpretedDecisionFollowThrough(
          followThrough,
          sourceResponse,
          answerSources,
          candidateFormat,
          state,
        )
        assertAutoSourceResponseFormatCompleteness({
          sourceResponse,
          answerSources,
          sourceResponseFormat: candidateFormat,
          sourceResponseState: state,
        })
      } catch (error) {
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

function materializeInterpretedPlanningAnswers(
  answers: InterpretablePlanningAnswer[] | undefined,
  sourceResponse?: string,
  answerSourcesByKey?: Map<string, string>,
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
  registerMatchingRunCandidateGroups(interpretationState, [
    ...explicitAnswers.map((answer) => buildPlanningAnswerSourceResponseCandidates(answer)),
  ])
  const materializedExplicitAnswers = explicitAnswers.map((answer) => ({
    summary: answer.summary,
    ...(answer.answerKey?.trim() ? { answerKey: answer.answerKey.trim() } : {}),
    ...(answer.summaryKey?.trim() ? { summaryKey: answer.summaryKey.trim() } : {}),
    ...(() => {
      const resolved = resolveAnswerContent(
        answer.answer,
        answer.sourceExcerpt,
        answer.sourceOccurrence,
        answer.answerSourceKey,
        sourceResponse,
        `planner answer ${answer.summary}`,
        answerSourcesByKey,
        pendingAnswerSourceEntries,
        matchingAnswerSourceEntries,
        sourceResponseFormat,
        buildPlanningAnswerSourceResponseCandidates(answer),
        interpretationState,
        buildPlanningPendingAnswerSourceConsumerDescriptor(answer),
      )
      return {
        ...(answer.prompt?.trim()
          ? { prompt: answer.prompt.trim() }
          : resolved.prompt
            ? { prompt: resolved.prompt }
            : {}),
        ...(answer.matchHints?.length ? { matchHints: answer.matchHints } : {}),
        answer: resolved.answer,
      }
    })(),
  }))
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
      ),
    )
    if (interpretationState) {
      interpretationState.nextPendingAnswerSourceIndex = entries.length
    }
    return answers
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
        ),
      )
    }
    return answers
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
        summary: stripQuestionBlockLabel(block.question),
        prompt: block.question,
        answer: block.answer,
      })
    }
    return answers
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
        summary: stripQuestionBlockLabel(clause.question),
        prompt: clause.question,
        answer: clause.answer,
      })
    }
    return answers
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
        summary: stripQuestionBlockLabel(span.question),
        prompt: span.question,
        answer: span.answer,
      })
    }
    return answers
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
        summary: stripQuestionBlockLabel(span.question),
        prompt: span.question,
        answer: span.answer,
      })
    }
    return answers
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
        summary: stripQuestionBlockLabel(span.question),
        prompt: span.question,
        answer: span.answer,
      })
    }
    return answers
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
        summary: stripQuestionBlockLabel(block.question),
        prompt: block.question,
        answer: block.answer,
      })
    }
    return answers
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
        summary: stripQuestionBlockLabel(block.question),
        prompt: block.question,
        answer: block.answer,
      })
    }
    return answers
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
      const summary = inferTopicSummaryFromTopicSentence(clause.text)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        answer: clause.text,
      })
    }
    return answers
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
      const summary = inferTopicSummaryFromTopicSentence(sentence.text)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        answer: sentence.text,
      })
    }
    return answers
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
      const summary = inferTopicSummaryFromTopicSpan(span)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        answer: span.text,
      })
    }
    return answers
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
      const summary = inferTopicSummaryFromTopicSpan(span)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        answer: span.text,
      })
    }
    return answers
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
      const summary = inferTopicSummaryFromTopicClosingSpan(span)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        answer: span.text,
      })
    }
    return answers
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
      const summary = inferTopicSummaryFromTopicClosingBlock(block)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        answer: block.text,
      })
    }
    return answers
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
      const summary = inferTopicSummaryFromTopicParagraph(paragraph.text)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        answer: paragraph.text,
      })
    }
    return answers
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
      const summary = inferTopicSummaryFromTopicBlock(block)
      answers.push({
        summary,
        prompt: synthesizeCanonicalPromptFromSummary(summary),
        answer: block.text,
      })
    }
    return answers
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
    const summary = inferTopicSummaryFromTopicBlock(block)
    answers.push({
      summary,
      prompt: synthesizeCanonicalPromptFromSummary(summary),
      answer: block.text,
    })
  }
  return answers
}

function resolveAnswerContent(
  answer: string | undefined,
  sourceExcerpt: string | undefined,
  sourceOccurrence: number | undefined,
  answerSourceKey: string | undefined,
  sourceResponse: string | undefined,
  label: string,
  answerSourcesByKey?: Map<string, string>,
  pendingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
  matchingAnswerSourceEntries?: ResolvedAnswerSourceEntry[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseCandidates: string[] = [],
  sourceResponseState?: InterpretedSourceResponseState,
  pendingAnswerSourceConsumerDescriptor?: PendingAnswerSourceConsumerDescriptor,
): ResolvedAnswerContent {
  const explicit = answer?.trim()
  if (explicit) {
    return { answer: explicit }
  }

  const directExcerpt = resolveSourceExcerpt(sourceExcerpt, sourceOccurrence, sourceResponse, label)
  if (directExcerpt) {
    return { answer: directExcerpt }
  }

  const referencedSourceKey = answerSourceKey?.trim()
  if (referencedSourceKey) {
    const sourced = answerSourcesByKey?.get(referencedSourceKey)
    if (!sourced) {
      throw new AnswerInterpretationError(
        `Unknown answerSourceKey "${referencedSourceKey}" for ${label}.`,
      )
    }
    return { answer: sourced }
  }

  if (sourceResponseFormat === 'labeled_sections') {
    return {
      answer: resolveLabeledSourceResponseSection(
        sourceResponse,
        sourceResponseCandidates,
        label,
        sourceResponseState,
      ),
    }
  }

  if (sourceResponseFormat === 'single_pending') {
    return {
      answer: consumeSinglePendingSourceResponse(sourceResponse, label, sourceResponseState),
    }
  }

  if (sourceResponseFormat === 'pending_clauses') {
    return {
      answer: resolvePendingSourceResponseClause(sourceResponse, label, sourceResponseState),
    }
  }

  if (sourceResponseFormat === 'pending_paragraphs') {
    return {
      answer: resolvePendingSourceResponseParagraph(sourceResponse, label, sourceResponseState),
    }
  }

  if (sourceResponseFormat === 'pending_sentences') {
    return {
      answer: resolvePendingSourceResponseSentence(sourceResponse, label, sourceResponseState),
    }
  }

  if (sourceResponseFormat === 'pending_conjunctions') {
    return {
      answer: resolvePendingSourceResponseConjunction(sourceResponse, label, sourceResponseState),
    }
  }

  if (sourceResponseFormat === 'pending_answer_sources') {
    return {
      answer: resolvePendingAnswerSourceValue(
        pendingAnswerSourceEntries,
        label,
        sourceResponseState,
        pendingAnswerSourceConsumerDescriptor,
      ),
    }
  }

  if (sourceResponseFormat === 'matching_answer_sources') {
    return {
      answer: resolveMatchingAnswerSourceValue(
        matchingAnswerSourceEntries,
        sourceResponseCandidates,
        label,
        sourceResponseState,
        pendingAnswerSourceConsumerDescriptor?.family,
      ),
    }
  }

  if (sourceResponseFormat === 'matching_runs') {
    return {
      answer: resolveMatchingRunSourceResponseValue(
        sourceResponse,
        sourceResponseCandidates,
        label,
        sourceResponseState,
      ),
    }
  }

  if (sourceResponseFormat === 'ordered_items') {
    return {
      answer: resolveOrderedSourceResponseItem(sourceResponse, label, sourceResponseState),
    }
  }

  if (sourceResponseFormat === 'ordered_blocks') {
    return {
      answer: resolveOrderedSourceResponseBlock(sourceResponse, label, sourceResponseState),
    }
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
    return {
      answer: questionBlock.answer,
      prompt: questionBlock.question,
    }
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
    return {
      answer: questionClause.answer,
      prompt: questionClause.question,
    }
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
    return {
      answer: questionSpan.answer,
      prompt: questionSpan.question,
    }
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
    return {
      answer: questionMiddleSpan.answer,
      prompt: questionMiddleSpan.question,
    }
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
    return {
      answer: questionClosingSpan.answer,
      prompt: questionClosingSpan.question,
    }
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
    return {
      answer: questionClosingBlock.answer,
      prompt: questionClosingBlock.question,
    }
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
    return {
      answer: questionMiddleBlock.answer,
      prompt: questionMiddleBlock.question,
    }
  }

  if (sourceResponseFormat === 'inline_topics') {
    return {
      answer: resolveInlineTopicSourceResponseSection(
        sourceResponse,
        sourceResponseCandidates,
        label,
        sourceResponseState,
      ),
    }
  }

  if (sourceResponseFormat === 'topic_clauses') {
    const topicClause = consumeTopicClauseSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!topicClause) {
      throw new AnswerInterpretationError(`No topic clause matched ${label} in sourceResponse.`)
    }
    return { answer: topicClause }
  }

  if (sourceResponseFormat === 'topic_sentences') {
    const topicSentence = consumeTopicSentenceSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!topicSentence) {
      throw new AnswerInterpretationError(`No topic sentence matched ${label} in sourceResponse.`)
    }
    return { answer: topicSentence }
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
    return { answer: topicSpan }
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
    return { answer: topicMiddleSpan }
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
    return { answer: topicClosingSpan }
  }

  if (sourceResponseFormat === 'topic_closing_blocks') {
    const topicClosingBlock = consumeTopicClosingBlockSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!topicClosingBlock) {
      throw new AnswerInterpretationError(
        `No topic closing block matched ${label} in sourceResponse.`,
      )
    }
    return { answer: topicClosingBlock }
  }

  if (sourceResponseFormat === 'topic_paragraphs') {
    const topicParagraph = consumeTopicParagraphSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!topicParagraph) {
      throw new AnswerInterpretationError(`No topic paragraph matched ${label} in sourceResponse.`)
    }
    return { answer: topicParagraph }
  }

  if (sourceResponseFormat === 'topic_middle_blocks') {
    const topicMiddleBlock = consumeTopicMiddleBlockSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!topicMiddleBlock) {
      throw new AnswerInterpretationError(
        `No topic middle block matched ${label} in sourceResponse.`,
      )
    }
    return { answer: topicMiddleBlock }
  }

  if (sourceResponseFormat === 'topic_blocks') {
    const topicBlock = consumeTopicBlockSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!topicBlock) {
      throw new AnswerInterpretationError(`No topic block matched ${label} in sourceResponse.`)
    }
    return { answer: topicBlock }
  }

  const shared = sourceResponse?.trim()
  if (shared) {
    return { answer: shared }
  }

  throw new AnswerInterpretationError(
    `Missing answer text for ${label}. Provide item.answer, answerSourceKey, or sourceResponse.`,
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
  const match = findLabeledSourceResponseSection(
    sectionsByLabel,
    candidates,
    sourceResponseState?.consumedLabeledSectionLabels,
  )
  if (match) {
    return match
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
  const match = findLabeledSourceResponseSection(
    sectionsByLabel,
    candidates,
    sourceResponseState?.consumedInlineTopicLabels,
  )
  if (match) {
    return match
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
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat single_pending requires sourceResponse for ${label}.`,
    )
  }

  if (sourceResponseState) {
    sourceResponseState.singlePendingConsumed = true
  }

  return shared
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
): GoalPlanningRequestAnswer {
  const summary = resolveRequiredAnswerSourceSummary(entry, label)
  const inferredSummaryKey = shouldDeriveSummaryKeyFromAnswerSourceKey(entry)
    ? inferSummaryKeyFromStableAnswerSourceKey(entry.key)
    : undefined
  return {
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
  }
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
      `Conflicting ${fieldLabel} values in contiguous answerSources for ${label}.`,
    )
  }
  return current
}

function mergeContiguousAnswerSourceEntries(
  entries: ResolvedAnswerSourceEntry[],
  label: string,
): ResolvedAnswerSourceEntry {
  const [firstEntry, ...restEntries] = entries
  if (!firstEntry) {
    throw new AnswerInterpretationError(`No contiguous answerSources remained for ${label}.`)
  }

  let mergedEntry: ResolvedAnswerSourceEntry = {
    ...firstEntry,
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
      candidates: dedupeNonEmptyStrings([...mergedEntry.candidates, ...entry.candidates]),
    }
  }

  return {
    ...mergedEntry,
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
        : mergeContiguousAnswerSourceEntries(group.entries, label),
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
        : mergeContiguousAnswerSourceEntries(
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

function materializeMixedRemainingAnswerSourceInference(input: {
  sourceResponse?: string
  answerSources?: InterpretableAnswerSource[]
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined
  sourceResponseState: InterpretedSourceResponseState | undefined
  knownDecisions: InterpretableKnownDecision[]
}) {
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
      ),
      planningAnswers: groupedEntries
        .filter((entry) => entry.route === 'planning')
        .map((entry) =>
          materializeRemainingPlanningAnswerFromAnswerSourceEntry(
            entry.entry,
            'followThrough.inferRemainingAnswers',
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
    ),
    planningAnswers: groupedEntries
      .filter((entry) => entry.route === 'planning')
      .map((entry) =>
        materializeRemainingPlanningAnswerFromAnswerSourceEntry(
          entry.entry,
          'followThrough.inferRemainingAnswers',
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

function parseMatchingRunSourceResponseUnits(sourceResponse: string | undefined, label: string) {
  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(
      `sourceResponseFormat matching_runs requires sourceResponse for ${label}.`,
    )
  }

  const paragraphs = parseTopicSourceResponseParagraphs(shared)
  if (paragraphs.length > 1) {
    return { units: paragraphs, joiner: '\n\n' }
  }

  const sentences = parseTopicSourceResponseSentences(shared)
  if (sentences.length > 1) {
    return { units: sentences, joiner: ' ' }
  }

  const clauses = parseTopicSourceResponseClauses(shared)
  if (clauses.length > 1) {
    return { units: clauses, joiner: ', ' }
  }

  return {
    units: [
      {
        text: shared,
        normalizedText: normalizeSourceResponseText(shared),
      },
    ],
    joiner: ' ',
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

  const summaryFromAnswerSourceKey = inferSummaryFromStableAnswerSourceKey(entry.key)
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
      'inferOpenDecisions requires sourceResponseFormat "labeled_sections", "single_pending", "pending_clauses", "pending_paragraphs", "pending_sentences", "pending_conjunctions", "pending_answer_sources", "matching_answer_sources", "matching_runs", "ordered_items", "ordered_blocks", "question_blocks", "question_clauses", "question_spans", "question_middle_spans", "question_closing_spans", "question_closing_blocks", "question_middle_blocks", "inline_topics", "topic_clauses", "topic_sentences", "topic_spans", "topic_middle_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", "topic_middle_blocks", or "topic_blocks".',
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
      match = findLabeledSourceResponseSection(
        sectionsByLabel ?? new Map<string, LabeledSourceResponseSection>(),
        buildOpenDecisionSourceResponseCandidates(decision),
        sourceResponseFormat === 'labeled_sections'
          ? sourceResponseState?.consumedLabeledSectionLabels
          : sourceResponseState?.consumedInlineTopicLabels,
      )
    } else if (sourceResponseFormat === 'single_pending') {
      match = consumeSinglePendingSourceResponse(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
    } else if (sourceResponseFormat === 'pending_clauses') {
      match = resolvePendingSourceResponseClause(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
    } else if (sourceResponseFormat === 'pending_paragraphs') {
      match = resolvePendingSourceResponseParagraph(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
    } else if (sourceResponseFormat === 'pending_sentences') {
      match = resolvePendingSourceResponseSentence(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
    } else if (sourceResponseFormat === 'pending_conjunctions') {
      match = resolvePendingSourceResponseConjunction(
        sourceResponse,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
      )
    } else if (sourceResponseFormat === 'pending_answer_sources') {
      match = resolvePendingAnswerSourceValue(
        pendingAnswerSourceEntries,
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        buildDecisionPendingAnswerSourceConsumerDescriptor(decision),
      )
    } else if (sourceResponseFormat === 'matching_answer_sources') {
      match = resolveMatchingAnswerSourceValue(
        matchingAnswerSourceEntries,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        'decision',
      )
    } else if (sourceResponseFormat === 'matching_runs') {
      match = resolveMatchingRunSourceResponseValue(
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
      )
    } else if (sourceResponseFormat === 'topic_sentences') {
      match = consumeTopicSentenceSourceResponseSection(
        sourceResponse,
        buildOpenDecisionSourceResponseCandidates(decision),
        `decision answer ${decision.decisionKey}`,
        sourceResponseState,
        false,
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
    }
    if (!match) {
      continue
    }
    materializedAnswers.push({
      summary: decision.summary,
      ...(decision.summaryKey?.trim() ? { summaryKey: decision.summaryKey.trim() } : {}),
      decisionKey: decision.decisionKey,
      taskRef: decision.taskRef,
      answer: match,
    })
  }

  return materializedAnswers
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
        summary: matchingKnownDecision?.summary ?? stripQuestionBlockLabel(block.question),
        prompt: matchingKnownDecision?.prompt ?? block.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.answer,
      })
    }

    return materializedAnswers
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
        summary: matchingKnownDecision?.summary ?? stripQuestionBlockLabel(clause.question),
        prompt: matchingKnownDecision?.prompt ?? clause.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: clause.answer,
      })
    }

    return materializedAnswers
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
        summary: matchingKnownDecision?.summary ?? stripQuestionBlockLabel(span.question),
        prompt: matchingKnownDecision?.prompt ?? span.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.answer,
      })
    }

    return materializedAnswers
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
        summary: matchingKnownDecision?.summary ?? stripQuestionBlockLabel(span.question),
        prompt: matchingKnownDecision?.prompt ?? span.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.answer,
      })
    }

    return materializedAnswers
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
        summary: matchingKnownDecision?.summary ?? stripQuestionBlockLabel(span.question),
        prompt: matchingKnownDecision?.prompt ?? span.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.answer,
      })
    }

    return materializedAnswers
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
        summary: matchingKnownDecision?.summary ?? stripQuestionBlockLabel(block.question),
        prompt: matchingKnownDecision?.prompt ?? block.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.answer,
      })
    }

    return materializedAnswers
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
        summary: matchingKnownDecision?.summary ?? stripQuestionBlockLabel(block.question),
        prompt: matchingKnownDecision?.prompt ?? block.question,
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.answer,
      })
    }

    return materializedAnswers
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

    return materializedAnswers
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

    return materializedAnswers
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
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicSpan(span)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.text,
      })
    }

    return materializedAnswers
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
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicSpan(span)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.text,
      })
    }

    return materializedAnswers
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
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicClosingSpan(span)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.text,
      })
    }

    return materializedAnswers
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

    return materializedAnswers
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

    return materializedAnswers
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
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicBlock(block)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.text,
      })
    }

    return materializedAnswers
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
      const summary = matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicBlock(block)
      materializedAnswers.push({
        summary,
        ...(matchingKnownDecision ? {} : { prompt: synthesizeCanonicalPromptFromSummary(summary) }),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: block.text,
      })
    }

    return materializedAnswers
  }

  const knownDecisionsBySummary = createKnownDecisionsBySummaryLookup(knownDecisions)
  for (const [normalizedLabel, section] of sectionsByLabel) {
    if (reservedLabels.has(normalizedLabel)) {
      continue
    }

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

  return materializedAnswers
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

  const spans = parseQuestionSourceResponseSpans(shared)
  if (sourceResponseState) {
    sourceResponseState.questionSpans = spans
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

  const spans = parseQuestionSourceResponseMiddleSpans(shared)
  if (sourceResponseState) {
    sourceResponseState.questionMiddleSpans = spans
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

  const spans = parseQuestionSourceResponseClosingSpans(shared)
  if (sourceResponseState) {
    sourceResponseState.questionClosingSpans = spans
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

  const clauses = parseTopicSourceResponseClauses(shared)
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

  const spans = parseTopicSourceResponseSpans(
    parseTopicSourceResponseSentences(shared),
    sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
  )
  if (sourceResponseState) {
    sourceResponseState.topicSpans = spans
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

  const spans = parseTopicSourceResponseMiddleSpans(
    parseTopicSourceResponseSentences(shared),
    sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
  )
  if (sourceResponseState) {
    sourceResponseState.topicMiddleSpans = spans
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

  const spans = parseTopicSourceResponseClosingSpans(
    parseTopicSourceResponseSentences(shared),
    sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
  )
  if (sourceResponseState) {
    sourceResponseState.topicClosingSpans = spans
  }
  return spans
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

function findLabeledSourceResponseSection(
  sectionsByLabel: Map<string, LabeledSourceResponseSection>,
  candidates: string[],
  consumedLabels?: Set<string>,
) {
  for (const candidate of candidates) {
    const normalizedLabel = normalizeSourceResponseLabel(candidate)
    const match = sectionsByLabel.get(normalizedLabel)
    if (match) {
      consumedLabels?.add(normalizedLabel)
      return match.value
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
  return consumeContiguousTopicSourceResponseText(
    sentences,
    matchingIndexes,
    `Multiple topic sentences matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicSentenceIndexes,
    ' ',
  )
}

function consumeTopicClauseSourceResponseSection(
  sourceResponse: string | undefined,
  candidates: string[],
  label: string,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  required: boolean,
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
  return consumeContiguousTopicSourceResponseText(
    clauses,
    matchingIndexes,
    `Multiple topic clauses matched ${label} in sourceResponse.`,
    sourceResponseState?.consumedTopicClauseIndexes,
    ' ',
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

  const clauses = parseTopicSourceResponseClauses(shared).map((clause) => clause.text)
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

  const paragraphs = parseTopicSourceResponseParagraphs(shared).map((paragraph) => paragraph.text)
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

  const sentences = parseTopicSourceResponseSentences(shared).map((sentence) => sentence.text)
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
    const match = /^(?:[-*•]\s*|\d+[.)]\s*)?(.*\S)$/.exec(trimmed)
    const value = match?.[1]?.trim()
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
    .map((block) => block.trim())
    .filter(Boolean)
}

function parseQuestionSourceResponseBlocks(sourceResponse: string) {
  const paragraphs = sourceResponse
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
  const blocks: QuestionSourceResponseBlock[] = []
  let currentQuestion: string | undefined
  let answerParagraphs: string[] = []

  for (const paragraph of paragraphs) {
    if (isQuestionSourceResponseParagraph(paragraph)) {
      if (currentQuestion) {
        if (answerParagraphs.length === 0) {
          throw new AnswerInterpretationError(
            `Question block "${currentQuestion}" in sourceResponse did not include an answer block.`,
          )
        }
        blocks.push({
          question: currentQuestion,
          normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
          normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
          answer: answerParagraphs.join('\n\n'),
        })
      } else if (answerParagraphs.length > 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_blocks requires sourceResponse to start with a question block.',
        )
      }
      currentQuestion = paragraph
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
  blocks.push({
    question: currentQuestion,
    normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
    normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
    answer: answerParagraphs.join('\n\n'),
  })
  return blocks
}

function parseQuestionSourceResponseClauses(sourceResponse: string) {
  const clauses = sourceResponse
    .split(/(?:\r?\n+|,+\s*|;+\s*)/)
    .map((clause) => clause.trim())
    .filter(Boolean)
  const parsedClauses: QuestionSourceResponseSpan[] = []

  for (const clause of clauses) {
    const match = /^(?<question>.+?[?？])\s*(?<answer>.*)$/u.exec(clause)?.groups
    if (!match?.question) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_clauses requires each clause to contain one question sentence followed by answer text.',
      )
    }

    const question = match.question.trim()
    const answer = match.answer?.trim()
    if (!answer) {
      throw new AnswerInterpretationError(
        `Question clause "${question}" in sourceResponse did not include answer text.`,
      )
    }

    parsedClauses.push({
      question,
      normalizedQuestionText: normalizeSourceResponseText(question),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(question),
      answer,
    })
  }

  return parsedClauses
}

function parseQuestionSourceResponseSpans(sourceResponse: string) {
  const sentences = parseTopicSourceResponseSentences(sourceResponse)
  const spans: QuestionSourceResponseSpan[] = []
  let currentQuestion: string | undefined
  let answerSentences: string[] = []

  for (const sentence of sentences) {
    if (isQuestionSourceResponseSentence(sentence.text)) {
      if (currentQuestion) {
        if (answerSentences.length === 0) {
          throw new AnswerInterpretationError(
            `Question span "${currentQuestion}" in sourceResponse did not include an answer sentence.`,
          )
        }
        spans.push({
          question: currentQuestion,
          normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
          normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
          answer: answerSentences.join(' '),
        })
      } else if (answerSentences.length > 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_spans requires sourceResponse to start with a question sentence.',
        )
      }
      currentQuestion = sentence.text
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
  spans.push({
    question: currentQuestion,
    normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
    normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
    answer: answerSentences.join(' '),
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
      currentQuestion = sentence.text
      trailingSentences = []
      continue
    }

    if (trailingSentences.length < 2) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_spans requires at least one trailing sentence before the next question sentence and at least one leading sentence for that next span.',
      )
    }

    spans.push({
      question: currentQuestion,
      normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
      answer: [...currentLeadingSentences, ...trailingSentences.slice(0, -1)].join(' '),
    })
    currentLeadingSentences = [trailingSentences[trailingSentences.length - 1] as string]
    currentQuestion = sentence.text
    trailingSentences = []
  }

  if (!currentQuestion) {
    return spans
  }
  if (trailingSentences.length === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_middle_spans requires each span to end with at least one trailing sentence after the question sentence.',
    )
  }
  spans.push({
    question: currentQuestion,
    normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
    normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
    answer: [...currentLeadingSentences, ...trailingSentences].join(' '),
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

    if (pendingAnswerSentences.length === 0) {
      throw new AnswerInterpretationError(
        `Question closing span "${sentence.text}" in sourceResponse did not include an answer sentence.`,
      )
    }

    spans.push({
      question: sentence.text,
      normalizedQuestionText: normalizeSourceResponseText(sentence.text),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(sentence.text),
      answer: pendingAnswerSentences.join(' '),
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

    if (pendingAnswerParagraphs.length === 0) {
      throw new AnswerInterpretationError(
        `Question closing block "${paragraph.text}" in sourceResponse did not include an answer block.`,
      )
    }

    blocks.push({
      question: paragraph.text,
      normalizedQuestionText: normalizeSourceResponseText(paragraph.text),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(paragraph.text),
      answer: pendingAnswerParagraphs.join('\n\n'),
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
      currentQuestion = paragraph.text
      trailingParagraphs = []
      continue
    }

    if (trailingParagraphs.length < 2) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_blocks requires at least one trailing paragraph before the next question paragraph and at least one leading paragraph for that next block.',
      )
    }

    blocks.push({
      question: currentQuestion,
      normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
      normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
      answer: [...currentLeadingParagraphs, ...trailingParagraphs.slice(0, -1)].join('\n\n'),
    })
    currentLeadingParagraphs = [trailingParagraphs[trailingParagraphs.length - 1] as string]
    currentQuestion = paragraph.text
    trailingParagraphs = []
  }

  if (!currentQuestion) {
    return blocks
  }
  if (trailingParagraphs.length === 0) {
    throw new AnswerInterpretationError(
      'sourceResponseFormat question_middle_blocks requires each block to end with at least one trailing paragraph after the question paragraph.',
    )
  }
  blocks.push({
    question: currentQuestion,
    normalizedQuestionText: normalizeSourceResponseText(currentQuestion),
    normalizedQuestionCoreText: normalizeQuestionPromptCore(currentQuestion),
    answer: [...currentLeadingParagraphs, ...trailingParagraphs].join('\n\n'),
  })
  return blocks
}

function isQuestionSourceResponseParagraph(paragraph: string) {
  return /[?？]\s*$/u.test(paragraph.trim())
}

function isQuestionSourceResponseSentence(sentence: string) {
  return /[?？]\s*$/u.test(sentence.trim())
}

function parseTopicSourceResponseSentences(sourceResponse: string) {
  return sourceResponse
    .split(/(?:\r?\n+|;+\s*|(?<=[.?!])\s+)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .map((sentence) => ({
      text: sentence,
      normalizedText: normalizeSourceResponseText(sentence),
    }))
}

function parseTopicSourceResponseClauses(sourceResponse: string) {
  return sourceResponse
    .split(/(?:\r?\n+|,+\s*|;+\s*|(?<=[.?!])\s+)/)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .map((clause) => ({
      text: clause,
      normalizedText: normalizeSourceResponseText(clause),
    }))
}

function parseTopicSourceResponseParagraphs(sourceResponse: string) {
  return sourceResponse
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      text: paragraph,
      normalizedText: normalizeSourceResponseText(paragraph),
    }))
}

function parsePendingSourceResponseConjunctions(sourceResponse: string) {
  return sourceResponse
    .split(/\s+(?:and then|then|and)\s+/i)
    .map((segment) => segment.trim())
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

    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple topic span anchors matched sentence "${sentence.text}" in sourceResponse.`,
      )
    }

    const anchorLabel = matchingLabels[0] ?? inferTopicSpanAnchorLabelFromSentence(sentence.text)
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

    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple topic middle span anchors matched sentence "${sentence.text}" in sourceResponse.`,
      )
    }

    const anchorLabel = matchingLabels[0] ?? inferTopicSpanAnchorLabelFromSentence(sentence.text)
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
    return spans
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

    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple topic closing span anchors matched sentence "${sentence.text}" in sourceResponse.`,
      )
    }

    const closingLabel = matchingLabels[0] ?? inferTopicClosingSpanLabelFromSentence(sentence.text)
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

    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple topic closing block anchors matched paragraph "${paragraph.text}" in sourceResponse.`,
      )
    }

    const closingLabel =
      matchingLabels[0] ?? inferTopicClosingBlockLabelFromParagraph(paragraph.text)
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

    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple topic block anchors matched paragraph "${paragraph.text}" in sourceResponse.`,
      )
    }

    const anchorLabel = matchingLabels[0] ?? inferTopicBlockAnchorLabelFromParagraph(paragraph.text)
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

    if (currentBlock) {
      currentBlock = {
        ...currentBlock,
        text: `${currentBlock.text}\n\n${paragraph.text}`,
      }
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

    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple topic middle block anchors matched paragraph "${paragraph.text}" in sourceResponse.`,
      )
    }

    const anchorLabel = matchingLabels[0] ?? inferTopicBlockAnchorLabelFromParagraph(paragraph.text)
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
    return blocks
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
  for (const line of sourceResponse.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const match = /^(?:[-*•]\s*)?([^:]+?)\s*:\s*(.+)$/.exec(trimmed)
    if (!match) {
      continue
    }
    const rawLabel = match[1]?.trim()
    const value = match[2]?.trim()
    if (!rawLabel || !value) {
      continue
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
    })
  }
  return sectionsByLabel
}

function parseInlineTopicSections(sourceResponse: string) {
  const sectionsByLabel = new Map<string, LabeledSourceResponseSection>()
  const clauses = sourceResponse
    .split(/(?:\r?\n+|;+\s*|(?<=[.?!])\s+)/)
    .map((clause) => clause.trim())
    .filter(Boolean)

  for (const clause of clauses) {
    const parsed = parseInlineTopicClause(clause)
    if (!parsed) {
      continue
    }

    const normalized = normalizeSourceResponseLabel(parsed.label)
    if (sectionsByLabel.has(normalized)) {
      throw new AnswerInterpretationError(
        `Duplicate inline topic clause "${parsed.label}" in sourceResponse.`,
      )
    }
    sectionsByLabel.set(normalized, parsed)
  }

  return sectionsByLabel
}

function parseInlineTopicClause(clause: string): LabeledSourceResponseSection | undefined {
  const trimmed = clause.trim().replace(/^(?:and|but)\s+/i, '')
  if (!trimmed) {
    return undefined
  }

  const punctuated = /^(?<label>.+?)\s*(?::|=|->)\s*(?<answer>.+)$/.exec(trimmed)?.groups
  if (punctuated?.label && punctuated.answer) {
    return {
      label: punctuated.label.trim(),
      value: normalizeInlineTopicAnswer(punctuated.answer),
    }
  }

  const dashed = /^(?<label>.+?)\s+-\s+(?<answer>.+)$/.exec(trimmed)?.groups
  if (dashed?.label && dashed.answer) {
    return {
      label: dashed.label.trim(),
      value: normalizeInlineTopicAnswer(dashed.answer),
    }
  }

  const verbal = new RegExp(
    `^(?<label>.+?)\\s+(?<answer>${TOPIC_SUMMARY_VERB_PATTERN}\\b.+)$`,
    'i',
  ).exec(trimmed)?.groups
  if (verbal?.label && verbal.answer) {
    return {
      label: verbal.label.trim(),
      value: normalizeInlineTopicAnswer(verbal.answer),
    }
  }

  return undefined
}

function normalizeInlineTopicAnswer(value: string) {
  const stripped = value
    .trim()
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
    (sourceResponseState.sourceResponseFormat !== 'topic_spans' &&
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
    sourceResponseState.topicSpans = undefined
    sourceResponseState.topicMiddleSpans = undefined
    sourceResponseState.topicClosingSpans = undefined
    sourceResponseState.topicClosingBlocks = undefined
    sourceResponseState.topicMiddleBlocks = undefined
    sourceResponseState.topicBlocks = undefined
  }
}

function registerMatchingRunCandidateGroups(
  sourceResponseState: InterpretedSourceResponseState | undefined,
  candidateGroups: string[][],
) {
  if (!sourceResponseState || sourceResponseState.sourceResponseFormat !== 'matching_runs') {
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
): MaterializedInterpretedDecisionAnswer[] {
  const knownDecisionsBySummary = createKnownDecisionsBySummaryLookup(knownDecisions)
  const knownDecisionsByDecisionKey = createKnownDecisionsByDecisionKeyLookup(knownDecisions)
  return entries.map((entry) => {
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
  return question
    .trim()
    .replace(/[?？]+\s*$/u, '')
    .trim()
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

function inferTopicSpanAnchorLabelFromSentence(sentence: string) {
  const summary = extractInferredTopicSummaries(sentence)[0]
  if (!summary) {
    return undefined
  }
  return normalizeSourceResponseLabel(summary)
}

function inferTopicClosingSpanLabelFromSentence(sentence: string) {
  const summary = extractInferredTopicSummaries(sentence)[0]
  if (!summary) {
    return undefined
  }
  return normalizeSourceResponseLabel(summary)
}

function inferTopicClosingBlockLabelFromParagraph(paragraph: string) {
  const summary = extractInferredTopicSummaries(paragraph)[0]
  if (!summary) {
    return undefined
  }
  return normalizeSourceResponseLabel(summary)
}

function inferTopicBlockAnchorLabelFromParagraph(paragraph: string) {
  const summary = extractInferredTopicSummaries(paragraph)[0]
  if (!summary) {
    return undefined
  }
  return normalizeSourceResponseLabel(summary)
}

function inferTopicSummaryFromTopicSentence(sentence: string) {
  const summaries = extractInferredTopicSummaries(sentence)
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
  const summaries = dedupeNonEmptyStrings(
    parseTopicSourceResponseSentences(paragraph).flatMap((sentence) =>
      extractInferredTopicSummaries(sentence.text),
    ),
  )
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
  if (firstToken && LEADING_TOPIC_SUMMARY_REJECT_TOKENS.has(firstToken)) {
    return undefined
  }

  return `${normalizedSummary.slice(0, 1).toUpperCase()}${normalizedSummary.slice(1)}`
}

function extractTrailingTopicSummary(text: string) {
  const match = /\bfor\s+(?!(?:the|a|an)\b)(?<summary>[A-Za-z0-9][A-Za-z0-9 _-]*?)\s*[.?!]?$/i.exec(
    text.trim(),
  )?.groups?.summary
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

  const subject = /^what should\s+(?<subject>.+?)\s+be\s*[?？]\s*$/i.exec(trimmed)?.groups?.subject
  if (!subject) {
    return synthesizeCanonicalPromptFromSummary(trimmed) === trimmed ? trimmed : undefined
  }

  return normalizeExtractedTopicSummary(subject, true)
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
  const trimmed = text.trim()
  if (!trimmed) {
    return undefined
  }

  const summary = new RegExp(
    `^(?:${TOPIC_SUMMARY_PREFIX_PATTERN})\\s+(?<summary>[A-Za-z0-9][A-Za-z0-9 _-]*?)\\s*(?:,|:|-)\\s+.+$`,
    'i',
  ).exec(trimmed)?.groups?.summary
  if (!summary) {
    return undefined
  }

  return normalizeExtractedTopicSummary(summary, true)
}

function extractAsTopicSummary(text: string) {
  const trimmed = text.trim()
  if (!trimmed) {
    return undefined
  }

  const summary = /\bas\s+(?:the|a|an)\s+(?<summary>[A-Za-z0-9][A-Za-z0-9 _-]*?)\s*[.?!]?$/i.exec(
    trimmed,
  )?.groups?.summary
  if (!summary) {
    return undefined
  }

  return normalizeExtractedTopicSummary(summary)
}

function extractCopularTopicSummary(text: string) {
  const trimmed = text.trim().replace(/^(?:and|but)\s+/i, '')
  if (!trimmed) {
    return undefined
  }

  const summary =
    /^(?:.+?)\s+(?:should\s+be|will\s+be|must\s+be|can\s+be|could\s+be|would\s+be|is|are|was|were|serves?\s+as|served\s+as|acts?\s+as|acted\s+as|functions?\s+as|functioned\s+as|remain|remains|remained)\s+(?:the|a|an|our|your|their)\s+(?<summary>[A-Za-z0-9][A-Za-z0-9 _-]*?)\s*[.?!]?$/i.exec(
      trimmed,
    )?.groups?.summary
  if (!summary) {
    return undefined
  }

  return normalizeExtractedTopicSummary(summary)
}

const LEADING_TOPIC_SUMMARY_REJECT_TOKENS = new Set([
  'about',
  ...QUESTION_CORE_LEADING_TOKENS,
  'he',
  'her',
  'here',
  'him',
  'i',
  'it',
  'me',
  'my',
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
  'you',
  'your',
  'regarding',
])

function extractLeadingTopicSummary(text: string) {
  const trimmed = text.trim().replace(/^(?:and|but)\s+/i, '')
  if (!trimmed) {
    return undefined
  }

  const label = new RegExp(`^(?<label>.+?)\\s+${TOPIC_SUMMARY_VERB_PATTERN}\\b.+$`, 'i').exec(
    trimmed,
  )?.groups?.label
  if (!label) {
    return undefined
  }

  return normalizeExtractedTopicSummary(label, true)
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
  const entries: ResolvedAnswerSourceEntry[] = []
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
    const route = source.route
    const summary = source.summary?.trim() || undefined
    const prompt = source.prompt?.trim() || undefined
    const matchHints = dedupeNonEmptyStrings(source.matchHints ?? [])
    answerSourcesByKey.set(key, resolved)
    entries.push({
      key,
      answer: resolved,
      route,
      decisionKey,
      answerKey,
      summaryKey,
      summary,
      prompt,
      ...(matchHints.length ? { matchHints } : {}),
      candidates: buildAnswerSourceResponseCandidates(source),
    })
  }
  return {
    byKey: answerSourcesByKey,
    entries,
  } satisfies ResolvedAnswerSources
}
