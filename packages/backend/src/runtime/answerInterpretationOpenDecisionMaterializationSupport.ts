import {
  type InterpretableAnswerSourceInput,
  type PendingAnswerSourceConsumerDescriptor,
  type ResolvedAnswerSourceEntry,
  createResolvedAnswerSources,
} from './answerInterpretationAnswerSourceSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
  LabeledSourceResponseSection,
} from './answerInterpretationTypes'

type MatchingAnswerSourceValueResolver = (
  matchingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  candidates: string[],
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
  consumerFamily?: 'decision' | 'planning',
) => string

type PendingAnswerSourceValueResolver = (
  pendingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
  consumerDescriptor?: PendingAnswerSourceConsumerDescriptor,
) => string

type PendingSourceResponseValueResolver = (
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
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
) => string | undefined

type TopicSourceResponseSectionConsumer = (
  ...args: [
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    enforceDirectSourceResponseCompleteness: boolean,
    rejectMultipleInferredTopicSummariesInTopicUnits?: boolean,
  ]
) => string | undefined

interface OpenDecisionLike {
  decisionKey: string
  summary: string
  summaryKey?: string
  taskRef?: string
}

export interface MaterializedMatchingOpenDecisionAnswer {
  summary: string
  summaryKey?: string
  decisionKey: string
  taskRef?: string
  answer: string
}

interface OpenDecisionMaterializationSupportDependencies<TDecision extends OpenDecisionLike> {
  assertLabeledValueAuthorityMatchesLabel: (
    label: string,
    value: string,
    unitLabel: string,
    valueLabel: string,
  ) => void
  assertMatchedAnswerTextAuthorityMatchesConsumer: (
    answer: string,
    candidates: string[],
    consumerLabel: string,
    sourceLabel?: 'answerSource' | 'sourceResponse',
  ) => void
  buildDecisionPendingAnswerSourceConsumerDescriptor: (
    decision: TDecision,
  ) => PendingAnswerSourceConsumerDescriptor
  buildOpenDecisionSourceResponseCandidates: (decision: TDecision) => string[]
  consumeQuestionBlockSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionClauseSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionClosingBlockSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionClosingSpanSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionMiddleBlockSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionMiddleSpanSourceResponseSection: QuestionSourceResponseSectionConsumer
  consumeQuestionSpanSourceResponseSection: QuestionSourceResponseSectionConsumer
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
  findLabeledSourceResponseSectionEntry: (
    sectionsByLabel: Map<string, LabeledSourceResponseSection>,
    candidates: string[],
    consumedLabels?: Set<string>,
  ) => LabeledSourceResponseSection | undefined
  parseRequiredInlineTopicSections: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => Map<string, LabeledSourceResponseSection>
  parseRequiredLabeledSourceResponseSections: (
    sourceResponse: string | undefined,
    context: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => Map<string, LabeledSourceResponseSection>
  registerMatchingRunCandidateGroups: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) => void
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

export function createAnswerInterpretationOpenDecisionMaterializationSupport<
  TDecision extends OpenDecisionLike,
>(dependencies: OpenDecisionMaterializationSupportDependencies<TDecision>) {
  function materializeMatchingOpenDecisionSurfaceAnswers(
    openDecisions: TDecision[],
    explicitDecisionKeys: Set<string>,
    sourceResponse: string | undefined,
    answerSources: InterpretableAnswerSourceInput[] | undefined,
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    assertSupportedOpenDecisionSourceResponseFormat(sourceResponseFormat)

    const resolvedAnswerSources = createResolvedAnswerSources(answerSources, sourceResponse)
    const pendingAnswerSourceEntries = resolvedAnswerSources?.entries
    const matchingAnswerSourceEntries = resolvedAnswerSources?.entries
    dependencies.registerMatchingRunCandidateGroups(
      sourceResponseState,
      openDecisions.map((decision) => dependencies.buildOpenDecisionSourceResponseCandidates(decision)),
    )

    const sectionsByLabel = resolveOpenDecisionSectionsByLabel(
      sourceResponseFormat,
      sourceResponse,
      sourceResponseState,
    )
    const materializedAnswers: MaterializedMatchingOpenDecisionAnswer[] = []

    for (const decision of openDecisions) {
      if (explicitDecisionKeys.has(decision.decisionKey)) {
        continue
      }

      const match = resolveOpenDecisionSurfaceMatch(
        decision,
        sourceResponse,
        sourceResponseFormat,
        sourceResponseState,
        sectionsByLabel,
        pendingAnswerSourceEntries,
        matchingAnswerSourceEntries,
      )
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

  function assertSupportedOpenDecisionSourceResponseFormat(
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
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
  }

  function resolveOpenDecisionSectionsByLabel(
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponse: string | undefined,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    if (sourceResponseFormat === 'labeled_sections') {
      return dependencies.parseRequiredLabeledSourceResponseSections(
        sourceResponse,
        'inferOpenDecisions',
        sourceResponseState,
      )
    }

    if (sourceResponseFormat === 'inline_topics') {
      return dependencies.parseRequiredInlineTopicSections(
        sourceResponse,
        'inferOpenDecisions',
        sourceResponseState,
      )
    }

    return undefined
  }

  function resolveOpenDecisionSurfaceMatch(
    decision: TDecision,
    sourceResponse: string | undefined,
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    sectionsByLabel: Map<string, LabeledSourceResponseSection> | undefined,
    pendingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
    matchingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  ) {
    const decisionLabel = `decision answer ${decision.decisionKey}`
    const candidates = dependencies.buildOpenDecisionSourceResponseCandidates(decision)

    if (sourceResponseFormat === 'labeled_sections' || sourceResponseFormat === 'inline_topics') {
      return resolveLabeledOpenDecisionMatch(
        sourceResponseFormat,
        sectionsByLabel ?? new Map<string, LabeledSourceResponseSection>(),
        candidates,
        sourceResponseState,
      )
    }

    if (sourceResponseFormat === 'single_pending') {
      return assertSourceResponseAuthorityMatch(
        dependencies.consumeSinglePendingSourceResponse(
          sourceResponse,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Single pending reply for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'pending_clauses') {
      return assertSourceResponseAuthorityMatch(
        dependencies.resolvePendingSourceResponseClause(
          sourceResponse,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Pending clause for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'pending_paragraphs') {
      return assertSourceResponseAuthorityMatch(
        dependencies.resolvePendingSourceResponseParagraph(
          sourceResponse,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Pending paragraph for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'pending_sentences') {
      return assertSourceResponseAuthorityMatch(
        dependencies.resolvePendingSourceResponseSentence(
          sourceResponse,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Pending sentence for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'pending_conjunctions') {
      return assertSourceResponseAuthorityMatch(
        dependencies.resolvePendingSourceResponseConjunction(
          sourceResponse,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Pending conjunction for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'pending_answer_sources') {
      return assertAnswerSourceAuthorityMatch(
        dependencies.resolvePendingAnswerSourceValue(
          pendingAnswerSourceEntries,
          decisionLabel,
          sourceResponseState,
          dependencies.buildDecisionPendingAnswerSourceConsumerDescriptor(decision),
        ),
        candidates,
        `Pending answerSource for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'matching_answer_sources') {
      return assertAnswerSourceAuthorityMatch(
        dependencies.resolveMatchingAnswerSourceValue(
          matchingAnswerSourceEntries,
          candidates,
          decisionLabel,
          sourceResponseState,
          'decision',
        ),
        candidates,
        `Matching answerSource for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'matching_runs') {
      return assertMatchingRunAuthorityMatch(
        dependencies.resolveMatchingRunSourceResponseValue(
          sourceResponse,
          candidates,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Matching run for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'matching_opening_runs') {
      return assertMatchingRunAuthorityMatch(
        dependencies.resolveMatchingOpeningRunSourceResponseValue(
          sourceResponse,
          candidates,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Matching opening run for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'matching_closing_runs') {
      return assertMatchingRunAuthorityMatch(
        dependencies.resolveMatchingClosingRunSourceResponseValue(
          sourceResponse,
          candidates,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Matching closing run for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'matching_middle_runs') {
      return assertMatchingRunAuthorityMatch(
        dependencies.resolveMatchingMiddleRunSourceResponseValue(
          sourceResponse,
          candidates,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Matching middle run for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'ordered_blocks') {
      return assertSourceResponseAuthorityMatch(
        dependencies.resolveOrderedSourceResponseBlock(
          sourceResponse,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Ordered block for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'ordered_items') {
      return assertSourceResponseAuthorityMatch(
        dependencies.resolveOrderedSourceResponseItem(
          sourceResponse,
          decisionLabel,
          sourceResponseState,
        ),
        candidates,
        `Ordered item for ${decisionLabel}`,
      )
    }

    if (sourceResponseFormat === 'question_blocks') {
      return dependencies.consumeQuestionBlockSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'question_clauses') {
      return dependencies.consumeQuestionClauseSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'question_spans') {
      return dependencies.consumeQuestionSpanSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'question_middle_spans') {
      return dependencies.consumeQuestionMiddleSpanSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'question_closing_spans') {
      return dependencies.consumeQuestionClosingSpanSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'question_closing_blocks') {
      return dependencies.consumeQuestionClosingBlockSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'question_middle_blocks') {
      return dependencies.consumeQuestionMiddleBlockSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'topic_clauses') {
      return dependencies.consumeTopicClauseSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
        true,
      )
    }

    if (sourceResponseFormat === 'topic_sentences') {
      return dependencies.consumeTopicSentenceSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
        true,
      )
    }

    if (sourceResponseFormat === 'topic_spans') {
      return dependencies.consumeTopicSpanSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'topic_middle_spans') {
      return dependencies.consumeTopicMiddleSpanSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'topic_closing_spans') {
      return dependencies.consumeTopicClosingSpanSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'topic_closing_blocks') {
      return dependencies.consumeTopicClosingBlockSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'topic_paragraphs') {
      return dependencies.consumeTopicParagraphSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
        true,
      )
    }

    if (sourceResponseFormat === 'topic_middle_blocks') {
      return dependencies.consumeTopicMiddleBlockSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    if (sourceResponseFormat === 'topic_blocks') {
      return dependencies.consumeTopicBlockSourceResponseSection(
        sourceResponse,
        candidates,
        decisionLabel,
        sourceResponseState,
        false,
      )
    }

    throw new AnswerInterpretationError(
      `Unsupported inferOpenDecisions sourceResponseFormat "${sourceResponseFormat}".`,
    )
  }

  function resolveLabeledOpenDecisionMatch(
    sourceResponseFormat: 'labeled_sections' | 'inline_topics',
    sectionsByLabel: Map<string, LabeledSourceResponseSection>,
    candidates: string[],
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    const matchSection = dependencies.findLabeledSourceResponseSectionEntry(
      sectionsByLabel,
      candidates,
      sourceResponseFormat === 'labeled_sections'
        ? sourceResponseState?.consumedLabeledSectionLabels
        : sourceResponseState?.consumedInlineTopicLabels,
    )
    if (!matchSection) {
      return undefined
    }

    dependencies.assertLabeledValueAuthorityMatchesLabel(
      matchSection.label,
      matchSection.value,
      sourceResponseFormat === 'labeled_sections' ? 'Labeled section' : 'Inline topic clause',
      sourceResponseFormat === 'labeled_sections' ? 'value text' : 'answer text',
    )
    return matchSection.value
  }

  function assertSourceResponseAuthorityMatch(
    match: string,
    candidates: string[],
    consumerLabel: string,
  ) {
    dependencies.assertMatchedAnswerTextAuthorityMatchesConsumer(
      match,
      candidates,
      consumerLabel,
      'sourceResponse',
    )
    return match
  }

  function assertAnswerSourceAuthorityMatch(
    match: string,
    candidates: string[],
    consumerLabel: string,
  ) {
    dependencies.assertMatchedAnswerTextAuthorityMatchesConsumer(
      match,
      candidates,
      consumerLabel,
      'answerSource',
    )
    return match
  }

  function assertMatchingRunAuthorityMatch(
    match: string | undefined,
    candidates: string[],
    consumerLabel: string,
  ) {
    if (match) {
      dependencies.assertMatchedAnswerTextAuthorityMatchesConsumer(
        match,
        candidates,
        consumerLabel,
      )
    }

    return match
  }

  return {
    materializeMatchingOpenDecisionSurfaceAnswers,
  }
}
