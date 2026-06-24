import { ANSWER_CAPTURE_FORMATS, type AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import type { ResolvedAnswerSourceEntry } from './answerInterpretationAnswerSourceSupport'

export const INTERPRETABLE_SOURCE_RESPONSE_FORMATS = ['auto', ...ANSWER_CAPTURE_FORMATS] as const

export type InterpretableSourceResponseFormat =
  (typeof INTERPRETABLE_SOURCE_RESPONSE_FORMATS)[number]

export interface LabeledSourceResponseSection {
  label: string
  value: string
  sourceLineIndex?: number
  sourceClauseIndex?: number
}

export interface TopicSourceResponseSentence {
  text: string
  normalizedText: string
}

export interface TopicSourceResponseParagraph {
  text: string
  normalizedText: string
}

export interface TopicSourceResponseSpan {
  text: string
  anchorText: string
  normalizedAnchorLabel: string
}

export interface TopicSourceResponseClosingSpan {
  text: string
  closingText: string
  normalizedClosingLabel: string
}

export interface TopicSourceResponseClosingBlock {
  text: string
  closingText: string
  normalizedClosingLabel: string
}

export interface QuestionSourceResponseBlock {
  question: string
  normalizedQuestionText: string
  normalizedQuestionCoreText: string
  answer: string
}

export interface QuestionSourceResponseSpan {
  question: string
  normalizedQuestionText: string
  normalizedQuestionCoreText: string
  answer: string
}

export interface QuestionSourceResponseClosingSpan {
  question: string
  normalizedQuestionText: string
  normalizedQuestionCoreText: string
  answer: string
}

export interface QuestionSourceResponseClosingBlock {
  question: string
  normalizedQuestionText: string
  normalizedQuestionCoreText: string
  answer: string
}

export interface TopicSourceResponseBlock {
  text: string
  anchorText: string
  normalizedAnchorLabel: string
}

export interface MatchingSourceResponseRun {
  text: string
  candidateGroupIndex: number
}

export interface EmbeddedMatchingRunToken {
  normalizedText: string
  start: number
  end: number
}

export interface EmbeddedMatchingRunAnchor {
  candidateGroupIndex: number
  startTokenIndex: number
  endTokenIndex: number
  startOriginal: number
  endOriginal: number
}

export interface EmbeddedTopicAnchor {
  normalizedLabel: string
  startTokenIndex: number
  endTokenIndex: number
  startOriginal: number
  endOriginal: number
}

export interface CanonicalQuestionAnchorMatch {
  rawQuestion: string
  canonicalPrompt: string
  endTokenIndex: number
  endOriginal: number
}

export interface ResolvedAnswerContent {
  answer: string
  prompt?: string
  captureFormat?: AnswerCaptureFormat
}

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
