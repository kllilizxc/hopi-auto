import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
} from '../storage/planningRequestStore'
import type { GoalPlanningBatchEntryInput } from './planningRequest'

export class AnswerInterpretationError extends Error {}

export type InterpretableSourceResponseFormat =
  | 'labeled_sections'
  | 'ordered_items'
  | 'ordered_blocks'
  | 'question_blocks'
  | 'question_spans'
  | 'question_closing_spans'
  | 'inline_topics'
  | 'topic_sentences'
  | 'topic_spans'
  | 'topic_closing_spans'
  | 'topic_closing_blocks'
  | 'topic_paragraphs'
  | 'topic_blocks'

export interface InterpretedSourceResponseState {
  sourceResponse?: string
  sourceResponseFormat: InterpretableSourceResponseFormat
  labeledSections?: Map<string, LabeledSourceResponseSection>
  inlineTopics?: Map<string, LabeledSourceResponseSection>
  questionBlocks?: QuestionSourceResponseBlock[]
  questionSpans?: QuestionSourceResponseSpan[]
  questionClosingSpans?: QuestionSourceResponseClosingSpan[]
  topicSentences?: TopicSourceResponseSentence[]
  topicSpans?: TopicSourceResponseSpan[]
  topicClosingSpans?: TopicSourceResponseClosingSpan[]
  topicClosingBlocks?: TopicSourceResponseClosingBlock[]
  topicParagraphs?: TopicSourceResponseParagraph[]
  topicBlocks?: TopicSourceResponseBlock[]
  topicAnchorCandidateLabels?: Set<string>
  orderedItems?: string[]
  orderedBlocks?: string[]
  nextOrderedItemIndex: number
  nextOrderedBlockIndex: number
  consumedQuestionBlockIndexes: Set<number>
  consumedQuestionSpanIndexes: Set<number>
  consumedQuestionClosingSpanIndexes: Set<number>
  consumedTopicSentenceIndexes: Set<number>
  consumedTopicSpanIndexes: Set<number>
  consumedTopicClosingSpanIndexes: Set<number>
  consumedTopicClosingBlockIndexes: Set<number>
  consumedTopicParagraphIndexes: Set<number>
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

interface TopicSourceResponseBlock {
  text: string
  anchorText: string
  normalizedAnchorLabel: string
}

interface ResolvedAnswerContent {
  answer: string
  prompt?: string
}

const TOPIC_SUMMARY_VERB_PATTERN =
  '(?:should|will|must|can|could|would|is|are|was|were|uses|use|means|requires|starts)'
const TOPIC_SUMMARY_PREFIX_PATTERN = '(?:for|about|regarding|on)'

export type InterpretableAnswerSource =
  | {
      answerSourceKey: string
      answer: string
    }
  | {
      answerSourceKey: string
      sourceExcerpt: string
    }

export interface InterpretablePlanningAnswer {
  summary: string
  prompt?: string
  answer?: string
  sourceExcerpt?: string
  answerSourceKey?: string
}

export interface InterpretableDecisionAnswerEntryInput {
  summary: string
  prompt?: string
  decisionKey?: string
  taskRef?: string
  answer?: string
  sourceExcerpt?: string
  answerSourceKey?: string
}

export interface InterpretableOpenDecision {
  decisionKey: string
  summary: string
  prompt?: string
  taskRef?: string
}

export interface InterpretableKnownDecision {
  decisionKey: string
  summary: string
  prompt?: string
  taskRef?: string
}

export interface MaterializedInterpretedDecisionAnswer {
  summary: string
  prompt?: string
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

export function createInterpretedSourceResponseState(
  sourceResponse: string | undefined,
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
): InterpretedSourceResponseState | undefined {
  if (!sourceResponseFormat) {
    return undefined
  }

  return {
    sourceResponse,
    sourceResponseFormat,
    nextOrderedItemIndex: 0,
    nextOrderedBlockIndex: 0,
    consumedQuestionBlockIndexes: new Set<number>(),
    consumedQuestionSpanIndexes: new Set<number>(),
    consumedQuestionClosingSpanIndexes: new Set<number>(),
    consumedTopicSentenceIndexes: new Set<number>(),
    consumedTopicSpanIndexes: new Set<number>(),
    consumedTopicClosingSpanIndexes: new Set<number>(),
    consumedTopicClosingBlockIndexes: new Set<number>(),
    consumedTopicParagraphIndexes: new Set<number>(),
    consumedTopicBlockIndexes: new Set<number>(),
  }
}

export function materializeInterpretedDecisionAnswers(
  answers: InterpretableDecisionAnswerEntryInput[],
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
  additionalSourceResponseCandidates: string[][] = [],
): MaterializedInterpretedDecisionAnswer[] {
  const answerSourcesByKey = createAnswerSourceLookup(answerSources, sourceResponse)
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  registerTopicAnchorCandidates(interpretationState, [
    ...answers.map((answer) => buildDecisionAnswerSourceResponseCandidates(answer)),
    ...additionalSourceResponseCandidates,
  ])

  return answers.map((answer) => {
    const resolved = resolveAnswerContent(
      answer.answer,
      answer.sourceExcerpt,
      answer.answerSourceKey,
      sourceResponse,
      `decision answer ${answer.decisionKey ?? answer.summary}`,
      answerSourcesByKey,
      sourceResponseFormat,
      buildDecisionAnswerSourceResponseCandidates(answer),
      interpretationState,
    )
    return {
      summary: answer.summary,
      prompt: answer.prompt?.trim() || resolved.prompt,
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
  const materializedExplicitAnswers = materializeInterpretedDecisionAnswers(
    explicitAnswers,
    sourceResponse,
    answerSources,
    sourceResponseFormat,
    interpretationState,
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
        sourceResponseFormat,
        interpretationState,
      )
    : []
  const materializedAnswers = [
    ...materializedExplicitAnswers,
    ...matchedOpenDecisionAnswers,
    ...materializeNewDecisionTopicAnswersFromLabeledSections(
      explicitAnswers,
      openDecisions,
      inferOpenDecisions,
      inferDecisionTopics,
      sourceResponse,
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
  const answerSourcesByKey = createAnswerSourceLookup(answerSources, sourceResponse)
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
          )
        : [],
    ),
    workflows,
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
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
  inferRemainingAnswers = false,
): GoalPlanningRequestAnswer[] | undefined {
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  const explicitAnswers = answers ?? []
  registerTopicAnchorCandidates(interpretationState, [
    ...explicitAnswers.map((answer) => [answer.summary]),
  ])
  const materializedExplicitAnswers = explicitAnswers.map((answer) => ({
    summary: answer.summary,
    ...(() => {
      const resolved = resolveAnswerContent(
        answer.answer,
        answer.sourceExcerpt,
        answer.answerSourceKey,
        sourceResponse,
        `planner answer ${answer.summary}`,
        answerSourcesByKey,
        sourceResponseFormat,
        buildPlanningAnswerSourceResponseCandidates(answer),
        interpretationState,
      )
      return {
        ...(answer.prompt?.trim()
          ? { prompt: answer.prompt.trim() }
          : resolved.prompt
            ? { prompt: resolved.prompt }
            : {}),
        answer: resolved.answer,
      }
    })(),
  }))
  const inferredAnswers = inferRemainingAnswers
    ? materializeRemainingInterpretedPlanningAnswers(
        sourceResponse,
        sourceResponseFormat,
        interpretationState,
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
) {
  if (
    sourceResponseFormat !== 'question_blocks' &&
    sourceResponseFormat !== 'question_spans' &&
    sourceResponseFormat !== 'question_closing_spans' &&
    sourceResponseFormat !== 'topic_sentences' &&
    sourceResponseFormat !== 'topic_spans' &&
    sourceResponseFormat !== 'topic_closing_spans' &&
    sourceResponseFormat !== 'topic_closing_blocks' &&
    sourceResponseFormat !== 'topic_paragraphs' &&
    sourceResponseFormat !== 'topic_blocks'
  ) {
    throw new AnswerInterpretationError(
      'followThrough.inferRemainingAnswers requires sourceResponseFormat "question_blocks", "question_spans", "question_closing_spans", "topic_sentences", "topic_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", or "topic_blocks".',
    )
  }

  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)

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
      answers.push({
        summary: inferTopicSummaryFromTopicSentence(sentence.text),
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
      answers.push({
        summary: inferTopicSummaryFromTopicSpan(span),
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
      answers.push({
        summary: inferTopicSummaryFromTopicClosingSpan(span),
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
      answers.push({
        summary: inferTopicSummaryFromTopicClosingBlock(block),
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
      answers.push({
        summary: inferTopicSummaryFromTopicParagraph(paragraph.text),
        answer: paragraph.text,
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
    answers.push({
      summary: inferTopicSummaryFromTopicBlock(block),
      answer: block.text,
    })
  }
  return answers
}

function resolveAnswerContent(
  answer: string | undefined,
  sourceExcerpt: string | undefined,
  answerSourceKey: string | undefined,
  sourceResponse: string | undefined,
  label: string,
  answerSourcesByKey?: Map<string, string>,
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseCandidates: string[] = [],
  sourceResponseState?: InterpretedSourceResponseState,
): ResolvedAnswerContent {
  const explicit = answer?.trim()
  if (explicit) {
    return { answer: explicit }
  }

  const directExcerpt = resolveSourceExcerpt(sourceExcerpt, sourceResponse, label)
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
    humanizeDecisionKey(answer.decisionKey),
    answer.summary,
    answer.prompt,
  ])
}

function buildPlanningAnswerSourceResponseCandidates(answer: InterpretablePlanningAnswer) {
  return dedupeNonEmptyStrings([answer.summary, answer.prompt])
}

function buildOpenDecisionSourceResponseCandidates(decision: InterpretableOpenDecision) {
  return dedupeNonEmptyStrings([
    humanizeDecisionKey(decision.decisionKey),
    decision.summary,
    decision.prompt,
  ])
}

function resolveSourceExcerpt(
  sourceExcerpt: string | undefined,
  sourceResponse: string | undefined,
  label: string,
) {
  const excerpt = sourceExcerpt?.trim()
  if (!excerpt) {
    return undefined
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(`sourceExcerpt for ${label} requires sourceResponse.`)
  }
  if (!shared.includes(excerpt)) {
    throw new AnswerInterpretationError(
      `sourceExcerpt for ${label} was not found in sourceResponse.`,
    )
  }
  return excerpt
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
  const match = findLabeledSourceResponseSection(sectionsByLabel, candidates)
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
  const match = findLabeledSourceResponseSection(sectionsByLabel, candidates)
  if (match) {
    return match
  }

  throw new AnswerInterpretationError(`No inline topic clause matched ${label} in sourceResponse.`)
}

function materializeMatchingOpenDecisionAnswers(
  openDecisions: InterpretableOpenDecision[],
  explicitDecisionKeys: Set<string>,
  sourceResponse: string | undefined,
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (
    sourceResponseFormat !== 'labeled_sections' &&
    sourceResponseFormat !== 'ordered_items' &&
    sourceResponseFormat !== 'ordered_blocks' &&
    sourceResponseFormat !== 'question_blocks' &&
    sourceResponseFormat !== 'question_spans' &&
    sourceResponseFormat !== 'question_closing_spans' &&
    sourceResponseFormat !== 'inline_topics' &&
    sourceResponseFormat !== 'topic_sentences' &&
    sourceResponseFormat !== 'topic_spans' &&
    sourceResponseFormat !== 'topic_closing_spans' &&
    sourceResponseFormat !== 'topic_closing_blocks' &&
    sourceResponseFormat !== 'topic_paragraphs' &&
    sourceResponseFormat !== 'topic_blocks'
  ) {
    throw new AnswerInterpretationError(
      'inferOpenDecisions requires sourceResponseFormat "labeled_sections", "ordered_items", "ordered_blocks", "question_blocks", "question_spans", "question_closing_spans", "inline_topics", "topic_sentences", "topic_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", or "topic_blocks".',
    )
  }

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
    } else if (sourceResponseFormat === 'question_spans') {
      match = consumeQuestionSpanSourceResponseSection(
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
      decisionKey: decision.decisionKey,
      taskRef: decision.taskRef,
      answer: match,
    })
  }

  return materializedAnswers
}

function materializeNewDecisionTopicAnswersFromLabeledSections(
  explicitAnswers: InterpretableDecisionAnswerEntryInput[],
  openDecisions: InterpretableOpenDecision[],
  inferOpenDecisions: boolean,
  inferDecisionTopics: boolean,
  sourceResponse: string | undefined,
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  sourceResponseState: InterpretedSourceResponseState | undefined,
  knownDecisions: InterpretableKnownDecision[],
  reservedAnswerCandidateGroups: string[][],
) {
  if (!inferDecisionTopics) {
    return []
  }

  if (
    sourceResponseFormat !== 'labeled_sections' &&
    sourceResponseFormat !== 'inline_topics' &&
    sourceResponseFormat !== 'question_blocks' &&
    sourceResponseFormat !== 'question_spans' &&
    sourceResponseFormat !== 'question_closing_spans' &&
    sourceResponseFormat !== 'topic_sentences' &&
    sourceResponseFormat !== 'topic_spans' &&
    sourceResponseFormat !== 'topic_closing_spans' &&
    sourceResponseFormat !== 'topic_closing_blocks' &&
    sourceResponseFormat !== 'topic_paragraphs' &&
    sourceResponseFormat !== 'topic_blocks'
  ) {
    throw new AnswerInterpretationError(
      'inferDecisionTopics requires sourceResponseFormat "labeled_sections", "inline_topics", "question_blocks", "question_spans", "question_closing_spans", "topic_sentences", "topic_spans", "topic_closing_spans", "topic_closing_blocks", "topic_paragraphs", or "topic_blocks".',
    )
  }

  const sectionsByLabel =
    sourceResponseFormat === 'labeled_sections'
      ? parseRequiredLabeledSourceResponseSections(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : parseRequiredInlineTopicSections(sourceResponse, 'inferDecisionTopics', sourceResponseState)
  const questionBlocks =
    sourceResponseFormat === 'question_blocks'
      ? parseRequiredQuestionSourceResponseBlocks(
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
  const questionClosingSpans =
    sourceResponseFormat === 'question_closing_spans'
      ? parseRequiredQuestionSourceResponseClosingSpans(
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
  const topicBlocks =
    sourceResponseFormat === 'topic_blocks'
      ? parseRequiredTopicSourceResponseBlocks(
          sourceResponse,
          'inferDecisionTopics',
          sourceResponseState,
        )
      : undefined
  const reservedLabels = new Set<string>()
  const reservedQuestionBlockIndexes = new Set<number>()
  const reservedQuestionSpanIndexes = new Set<number>()
  const reservedQuestionClosingSpanIndexes = new Set<number>()
  const reservedTopicSentenceIndexes = new Set<number>()
  const reservedTopicSpanIndexes = new Set<number>()
  const reservedTopicClosingSpanIndexes = new Set<number>()
  const reservedTopicClosingBlockIndexes = new Set<number>()
  const reservedTopicParagraphIndexes = new Set<number>()
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

    if (questionSpans) {
      reserveMatchedQuestionSpan(
        questionSpans,
        buildDecisionAnswerSourceResponseCandidates(answer),
        reservedQuestionSpanIndexes,
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

      if (questionSpans) {
        reserveMatchedQuestionSpan(
          questionSpans,
          buildOpenDecisionSourceResponseCandidates(decision),
          reservedQuestionSpanIndexes,
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

    if (questionSpans) {
      reserveMatchedQuestionSpan(questionSpans, candidates, reservedQuestionSpanIndexes)
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

    if (topicSentences) {
      reserveMatchedTopicSentence(topicSentences, candidates, reservedTopicSentenceIndexes)
      continue
    }

    if (topicSpans) {
      reserveMatchedTopicSpan(topicSpans, candidates, reservedTopicSpanIndexes)
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
      materializedAnswers.push({
        summary:
          matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicSentence(sentence.text),
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
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicSpan(span),
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
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicClosingSpan(span),
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
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicClosingBlock(block),
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
      materializedAnswers.push({
        summary:
          matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicParagraph(paragraph.text),
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: paragraph.text,
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
      materializedAnswers.push({
        summary: matchingKnownDecision?.summary ?? inferTopicSummaryFromTopicBlock(block),
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

    const matchingKnownDecisions = knownDecisionsBySummary.get(normalizedLabel) ?? []
    if (matchingKnownDecisions.length > 1) {
      throw new AnswerInterpretationError(
        `Multiple existing decisions match inferred label "${section.label}".`,
      )
    }

    const matchingKnownDecision = matchingKnownDecisions[0]
    materializedAnswers.push({
      summary: matchingKnownDecision?.summary ?? section.label,
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
) {
  for (const candidate of candidates) {
    const match = sectionsByLabel.get(normalizeSourceResponseLabel(candidate))
    if (match) {
      return match.value
    }
  }
  return undefined
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
  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(
      `Multiple question blocks matched ${label} in sourceResponse.`,
    )
  }

  const blockIndex = matchingIndexes[0]
  if (blockIndex === undefined) {
    return undefined
  }
  if (sourceResponseState) {
    sourceResponseState.consumedQuestionBlockIndexes.add(blockIndex)
  }
  return blocks[blockIndex]
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
  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(
      `Multiple question spans matched ${label} in sourceResponse.`,
    )
  }

  const spanIndex = matchingIndexes[0]
  if (spanIndex === undefined) {
    return undefined
  }
  if (sourceResponseState) {
    sourceResponseState.consumedQuestionSpanIndexes.add(spanIndex)
  }
  return spans[spanIndex]
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
  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(
      `Multiple question closing spans matched ${label} in sourceResponse.`,
    )
  }

  const spanIndex = matchingIndexes[0]
  if (spanIndex === undefined) {
    return undefined
  }
  if (sourceResponseState) {
    sourceResponseState.consumedQuestionClosingSpanIndexes.add(spanIndex)
  }
  return spans[spanIndex]
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
  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(
      `Multiple topic sentences matched ${label} in sourceResponse.`,
    )
  }

  const sentenceIndex = matchingIndexes[0]
  if (sentenceIndex === undefined) {
    return undefined
  }
  if (sourceResponseState) {
    sourceResponseState.consumedTopicSentenceIndexes.add(sentenceIndex)
  }
  return sentences[sentenceIndex]?.text
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
  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(`Multiple topic spans matched ${label} in sourceResponse.`)
  }

  const spanIndex = matchingIndexes[0]
  if (spanIndex === undefined) {
    return undefined
  }
  if (sourceResponseState) {
    sourceResponseState.consumedTopicSpanIndexes.add(spanIndex)
  }
  return spans[spanIndex]?.text
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
  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(
      `Multiple topic closing spans matched ${label} in sourceResponse.`,
    )
  }

  const spanIndex = matchingIndexes[0]
  if (spanIndex === undefined) {
    return undefined
  }
  if (sourceResponseState) {
    sourceResponseState.consumedTopicClosingSpanIndexes.add(spanIndex)
  }
  return spans[spanIndex]?.text
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
  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(
      `Multiple topic closing blocks matched ${label} in sourceResponse.`,
    )
  }

  const blockIndex = matchingIndexes[0]
  if (blockIndex === undefined) {
    return undefined
  }
  if (sourceResponseState) {
    sourceResponseState.consumedTopicClosingBlockIndexes.add(blockIndex)
  }
  return blocks[blockIndex]?.text
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
  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(
      `Multiple topic paragraphs matched ${label} in sourceResponse.`,
    )
  }

  const paragraphIndex = matchingIndexes[0]
  if (paragraphIndex === undefined) {
    return undefined
  }
  if (sourceResponseState) {
    sourceResponseState.consumedTopicParagraphIndexes.add(paragraphIndex)
  }
  return paragraphs[paragraphIndex]?.text
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
  if (matchingIndexes.length > 1) {
    throw new AnswerInterpretationError(`Multiple topic blocks matched ${label} in sourceResponse.`)
  }

  const blockIndex = matchingIndexes[0]
  if (blockIndex === undefined) {
    return undefined
  }
  if (sourceResponseState) {
    sourceResponseState.consumedTopicBlockIndexes.add(blockIndex)
  }
  return blocks[blockIndex]?.text
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

function findMatchingTopicSentenceIndexes(
  sentences: TopicSourceResponseSentence[],
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

    sentences.forEach((sentence, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (
        topicTextMatchesCandidate(
          sentence.normalizedText,
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

function findMatchingTopicParagraphIndexes(
  paragraphs: TopicSourceResponseParagraph[],
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

    paragraphs.forEach((paragraph, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (
        topicTextMatchesCandidate(
          paragraph.normalizedText,
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
      sourceResponseState.sourceResponseFormat !== 'topic_closing_spans' &&
      sourceResponseState.sourceResponseFormat !== 'topic_closing_blocks' &&
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
    sourceResponseState.topicClosingSpans = undefined
    sourceResponseState.topicClosingBlocks = undefined
    sourceResponseState.topicBlocks = undefined
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
  const matchingIndexes = findMatchingQuestionBlockIndexes(blocks, candidates, reservedIndexes)
  const firstMatch = matchingIndexes[0]
  if (firstMatch !== undefined) {
    reservedIndexes.add(firstMatch)
  }
}

function reserveMatchedQuestionSpan(
  spans: QuestionSourceResponseSpan[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  const matchingIndexes = findMatchingQuestionSpanIndexes(spans, candidates, reservedIndexes)
  const firstMatch = matchingIndexes[0]
  if (firstMatch !== undefined) {
    reservedIndexes.add(firstMatch)
  }
}

function reserveMatchedQuestionClosingSpan(
  spans: QuestionSourceResponseClosingSpan[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  const matchingIndexes = findMatchingQuestionClosingSpanIndexes(spans, candidates, reservedIndexes)
  const firstMatch = matchingIndexes[0]
  if (firstMatch !== undefined) {
    reservedIndexes.add(firstMatch)
  }
}

function reserveMatchedTopicSentence(
  sentences: TopicSourceResponseSentence[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  const matchingIndexes = findMatchingTopicSentenceIndexes(sentences, candidates, reservedIndexes)
  const firstMatch = matchingIndexes[0]
  if (firstMatch !== undefined) {
    reservedIndexes.add(firstMatch)
  }
}

function reserveMatchedTopicSpan(
  spans: TopicSourceResponseSpan[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  const matchingIndexes = findMatchingTopicSpanIndexes(spans, candidates, reservedIndexes)
  const firstMatch = matchingIndexes[0]
  if (firstMatch !== undefined) {
    reservedIndexes.add(firstMatch)
  }
}

function reserveMatchedTopicClosingSpan(
  spans: TopicSourceResponseClosingSpan[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  const matchingIndexes = findMatchingTopicClosingSpanIndexes(spans, candidates, reservedIndexes)
  const firstMatch = matchingIndexes[0]
  if (firstMatch !== undefined) {
    reservedIndexes.add(firstMatch)
  }
}

function reserveMatchedTopicClosingBlock(
  blocks: TopicSourceResponseClosingBlock[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  const matchingIndexes = findMatchingTopicClosingBlockIndexes(blocks, candidates, reservedIndexes)
  const firstMatch = matchingIndexes[0]
  if (firstMatch !== undefined) {
    reservedIndexes.add(firstMatch)
  }
}

function reserveMatchedTopicParagraph(
  paragraphs: TopicSourceResponseParagraph[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  const matchingIndexes = findMatchingTopicParagraphIndexes(paragraphs, candidates, reservedIndexes)
  const firstMatch = matchingIndexes[0]
  if (firstMatch !== undefined) {
    reservedIndexes.add(firstMatch)
  }
}

function reserveMatchedTopicBlock(
  blocks: TopicSourceResponseBlock[],
  candidates: string[],
  reservedIndexes: Set<number>,
) {
  const matchingIndexes = findMatchingTopicBlockIndexes(blocks, candidates, reservedIndexes)
  const firstMatch = matchingIndexes[0]
  if (firstMatch !== undefined) {
    reservedIndexes.add(firstMatch)
  }
}

function createKnownDecisionsBySummaryLookup(knownDecisions: InterpretableKnownDecision[]) {
  const lookup = new Map<string, InterpretableKnownDecision[]>()
  for (const decision of knownDecisions) {
    const normalized = normalizeSourceResponseLabel(decision.summary)
    const existing = lookup.get(normalized)
    if (existing) {
      existing.push(decision)
      continue
    }
    lookup.set(normalized, [decision])
  }
  return lookup
}

function findMatchingKnownDecisionsForQuestionBlock(
  block: QuestionSourceResponseBlock,
  knownDecisions: InterpretableKnownDecision[],
) {
  return knownDecisions.filter(
    (decision) =>
      findMatchingQuestionBlockIndexes(
        [block],
        dedupeNonEmptyStrings([humanizeDecisionKey(decision.decisionKey), decision.summary]),
        new Set<number>(),
      ).length > 0 ||
      findMatchingQuestionBlockIndexes(
        [block],
        dedupeNonEmptyStrings([decision.prompt]),
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
        dedupeNonEmptyStrings([humanizeDecisionKey(decision.decisionKey), decision.summary]),
        new Set<number>(),
      ).length > 0 ||
      findMatchingQuestionSpanIndexes(
        [span],
        dedupeNonEmptyStrings([decision.prompt]),
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
        dedupeNonEmptyStrings([humanizeDecisionKey(decision.decisionKey), decision.summary]),
        new Set<number>(),
      ).length > 0 ||
      findMatchingQuestionClosingSpanIndexes(
        [span],
        dedupeNonEmptyStrings([decision.prompt]),
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
  return dedupeNonEmptyStrings([
    extractPrefixedTopicSummary(text),
    extractAsTopicSummary(text),
    extractLeadingTopicSummary(text),
    extractTrailingTopicSummary(text),
  ])
}

function humanizeDecisionKey(value: string | undefined) {
  return value?.trim().replace(/[_-]+/g, ' ')
}

function buildKnownDecisionSourceResponseCandidates(decision: InterpretableKnownDecision) {
  return dedupeNonEmptyStrings([
    humanizeDecisionKey(decision.decisionKey),
    decision.summary,
    decision.prompt,
  ])
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

function createAnswerSourceLookup(
  answerSources: InterpretableAnswerSource[] | undefined,
  sourceResponse: string | undefined,
) {
  if (!answerSources || answerSources.length === 0) {
    return undefined
  }

  const answerSourcesByKey = new Map<string, string>()
  for (const source of answerSources) {
    const key = source.answerSourceKey.trim()
    if (answerSourcesByKey.has(key)) {
      throw new AnswerInterpretationError(`Duplicate answerSourceKey: ${key}`)
    }
    if ('answer' in source) {
      answerSourcesByKey.set(key, source.answer.trim())
      continue
    }

    const sourceExcerpt = source.sourceExcerpt.trim()
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceExcerpt for answerSourceKey "${key}" requires sourceResponse.`,
      )
    }
    if (!shared.includes(sourceExcerpt)) {
      throw new AnswerInterpretationError(
        `sourceExcerpt for answerSourceKey "${key}" was not found in sourceResponse.`,
      )
    }
    answerSourcesByKey.set(key, sourceExcerpt)
  }
  return answerSourcesByKey
}
