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
  | 'inline_topics'
  | 'topic_sentences'
  | 'topic_paragraphs'
  | 'topic_blocks'

export interface InterpretedSourceResponseState {
  sourceResponse?: string
  sourceResponseFormat: InterpretableSourceResponseFormat
  labeledSections?: Map<string, LabeledSourceResponseSection>
  inlineTopics?: Map<string, LabeledSourceResponseSection>
  questionBlocks?: QuestionSourceResponseBlock[]
  questionSpans?: QuestionSourceResponseSpan[]
  topicSentences?: TopicSourceResponseSentence[]
  topicParagraphs?: TopicSourceResponseParagraph[]
  topicBlocks?: TopicSourceResponseBlock[]
  topicBlockCandidateLabels?: Set<string>
  orderedItems?: string[]
  orderedBlocks?: string[]
  nextOrderedItemIndex: number
  nextOrderedBlockIndex: number
  consumedQuestionBlockIndexes: Set<number>
  consumedQuestionSpanIndexes: Set<number>
  consumedTopicSentenceIndexes: Set<number>
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

interface QuestionSourceResponseBlock {
  question: string
  normalizedQuestionText: string
  answer: string
}

interface QuestionSourceResponseSpan {
  question: string
  normalizedQuestionText: string
  answer: string
}

interface TopicSourceResponseBlock {
  text: string
  normalizedAnchorLabel: string
}

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
  taskRef?: string
}

export interface InterpretableKnownDecision {
  decisionKey: string
  summary: string
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
  title: string
  description: string
  acceptanceCriteria: string[]
  answers?: InterpretablePlanningAnswer[]
  requestedUpdates?: GoalPlanningRequestUpdateTarget[]
}

export interface InterpretableDecisionPlanningBatchFollowThroughInput {
  kind: 'planning_batch'
  groupKey: string
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
    consumedTopicSentenceIndexes: new Set<number>(),
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
  registerTopicBlockCandidates(interpretationState, [
    ...answers.map((answer) => buildDecisionAnswerSourceResponseCandidates(answer)),
    ...additionalSourceResponseCandidates,
  ])

  return answers.map((answer) => ({
    summary: answer.summary,
    prompt: answer.prompt?.trim() || undefined,
    decisionKey: answer.decisionKey,
    taskRef: answer.taskRef,
    answer: resolveAnswerText(
      answer.answer,
      answer.sourceExcerpt,
      answer.answerSourceKey,
      sourceResponse,
      `decision answer ${answer.decisionKey ?? answer.summary}`,
      answerSourcesByKey,
      sourceResponseFormat,
      buildDecisionAnswerSourceResponseCandidates(answer),
      interpretationState,
    ),
  }))
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
  reservedAnswerSummaries: string[] = [],
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
  registerTopicBlockCandidates(interpretationState, [
    ...explicitAnswers.map((answer) => buildDecisionAnswerSourceResponseCandidates(answer)),
    ...openDecisions.map((decision) => buildOpenDecisionSourceResponseCandidates(decision)),
    ...reservedAnswerSummaries.map((summary) => [summary]),
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
      reservedAnswerSummaries,
    ),
  ]

  if (materializedAnswers.length === 0) {
    throw new AnswerInterpretationError(
      'No decision answers were materialized. Provide explicit answers or use inferOpenDecisions with structured sourceResponse items that match at least one open decision.',
    )
  }

  return materializedAnswers
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
  registerTopicBlockCandidates(interpretationState, [
    ...listInterpretableFollowThroughAnswerSummaries(followThrough).map((summary) => [summary]),
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
      ),
    }
  }

  return {
    kind: 'workflow_batch' as const,
    workflowKey: followThrough.workflowKey,
    reuseTaskRef: followThrough.reuseTaskRef,
    reuseGroupKey: followThrough.reuseGroupKey,
    answers: materializeInterpretedPlanningAnswers(
      followThrough.answers,
      sourceResponse,
      answerSourcesByKey,
      sourceResponseFormat,
      interpretationState,
    ),
    workflows: followThrough.workflows.map((workflow) => {
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
    }),
  }
}

function materializeInterpretedPlanningAnswers(
  answers: InterpretablePlanningAnswer[] | undefined,
  sourceResponse?: string,
  answerSourcesByKey?: Map<string, string>,
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
): GoalPlanningRequestAnswer[] | undefined {
  if (!answers || answers.length === 0) {
    return answers ? [] : undefined
  }

  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  registerTopicBlockCandidates(interpretationState, [...answers.map((answer) => [answer.summary])])
  return answers.map((answer) => ({
    summary: answer.summary,
    answer: resolveAnswerText(
      answer.answer,
      answer.sourceExcerpt,
      answer.answerSourceKey,
      sourceResponse,
      `planner answer ${answer.summary}`,
      answerSourcesByKey,
      sourceResponseFormat,
      [answer.summary],
      interpretationState,
    ),
  }))
}

function resolveAnswerText(
  answer: string | undefined,
  sourceExcerpt: string | undefined,
  answerSourceKey: string | undefined,
  sourceResponse: string | undefined,
  label: string,
  answerSourcesByKey?: Map<string, string>,
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseCandidates: string[] = [],
  sourceResponseState?: InterpretedSourceResponseState,
): string {
  const explicit = answer?.trim()
  if (explicit) {
    return explicit
  }

  const directExcerpt = resolveSourceExcerpt(sourceExcerpt, sourceResponse, label)
  if (directExcerpt) {
    return directExcerpt
  }

  const referencedSourceKey = answerSourceKey?.trim()
  if (referencedSourceKey) {
    const sourced = answerSourcesByKey?.get(referencedSourceKey)
    if (!sourced) {
      throw new AnswerInterpretationError(
        `Unknown answerSourceKey "${referencedSourceKey}" for ${label}.`,
      )
    }
    return sourced
  }

  if (sourceResponseFormat === 'labeled_sections') {
    return resolveLabeledSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
    )
  }

  if (sourceResponseFormat === 'ordered_items') {
    return resolveOrderedSourceResponseItem(sourceResponse, label, sourceResponseState)
  }

  if (sourceResponseFormat === 'ordered_blocks') {
    return resolveOrderedSourceResponseBlock(sourceResponse, label, sourceResponseState)
  }

  if (sourceResponseFormat === 'question_blocks') {
    const questionBlock = consumeQuestionBlockSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!questionBlock) {
      throw new AnswerInterpretationError(`No question block matched ${label} in sourceResponse.`)
    }
    return questionBlock
  }

  if (sourceResponseFormat === 'question_spans') {
    const questionSpan = consumeQuestionSpanSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
      true,
    )
    if (!questionSpan) {
      throw new AnswerInterpretationError(`No question span matched ${label} in sourceResponse.`)
    }
    return questionSpan
  }

  if (sourceResponseFormat === 'inline_topics') {
    return resolveInlineTopicSourceResponseSection(
      sourceResponse,
      sourceResponseCandidates,
      label,
      sourceResponseState,
    )
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
    return topicSentence
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
    return topicParagraph
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
    return topicBlock
  }

  const shared = sourceResponse?.trim()
  if (shared) {
    return shared
  }

  throw new AnswerInterpretationError(
    `Missing answer text for ${label}. Provide item.answer, answerSourceKey, or sourceResponse.`,
  )
}

function buildDecisionAnswerSourceResponseCandidates(
  answer: InterpretableDecisionAnswerEntryInput,
) {
  return dedupeNonEmptyStrings([humanizeDecisionKey(answer.decisionKey), answer.summary])
}

function buildOpenDecisionSourceResponseCandidates(decision: InterpretableOpenDecision) {
  return dedupeNonEmptyStrings([humanizeDecisionKey(decision.decisionKey), decision.summary])
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
    sourceResponseFormat !== 'inline_topics' &&
    sourceResponseFormat !== 'topic_sentences' &&
    sourceResponseFormat !== 'topic_paragraphs' &&
    sourceResponseFormat !== 'topic_blocks'
  ) {
    throw new AnswerInterpretationError(
      'inferOpenDecisions requires sourceResponseFormat "labeled_sections", "ordered_items", "ordered_blocks", "question_blocks", "question_spans", "inline_topics", "topic_sentences", "topic_paragraphs", or "topic_blocks".',
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
    } else if (sourceResponseFormat === 'topic_sentences') {
      match = consumeTopicSentenceSourceResponseSection(
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
  reservedAnswerSummaries: string[],
) {
  if (!inferDecisionTopics) {
    return []
  }

  if (
    sourceResponseFormat !== 'labeled_sections' &&
    sourceResponseFormat !== 'inline_topics' &&
    sourceResponseFormat !== 'question_blocks' &&
    sourceResponseFormat !== 'question_spans'
  ) {
    throw new AnswerInterpretationError(
      'inferDecisionTopics requires sourceResponseFormat "labeled_sections", "inline_topics", "question_blocks", or "question_spans".',
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
  const reservedLabels = new Set<string>()
  const reservedQuestionBlockIndexes = new Set<number>()
  const reservedQuestionSpanIndexes = new Set<number>()

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

      reserveMatchedLabeledSection(
        sectionsByLabel,
        buildOpenDecisionSourceResponseCandidates(decision),
        reservedLabels,
      )
    }
  }

  for (const summary of reservedAnswerSummaries) {
    if (questionBlocks) {
      reserveMatchedQuestionBlock(questionBlocks, [summary], reservedQuestionBlockIndexes)
      continue
    }

    if (questionSpans) {
      reserveMatchedQuestionSpan(questionSpans, [summary], reservedQuestionSpanIndexes)
      continue
    }

    reserveMatchedLabeledSection(sectionsByLabel, [summary], reservedLabels)
  }

  const materializedAnswers: Array<{
    summary: string
    decisionKey?: string
    taskRef?: string
    answer: string
  }> = []

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
        decisionKey: matchingKnownDecision?.decisionKey,
        taskRef: matchingKnownDecision?.taskRef,
        answer: span.answer,
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
    sourceResponseState?.topicBlockCandidateLabels ?? new Set<string>(),
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

function consumeQuestionBlockSourceResponseSection(
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
  return blocks[blockIndex]?.answer
}

function consumeQuestionSpanSourceResponseSection(
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
  return spans[spanIndex]?.answer
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
  registerTopicBlockCandidates(sourceResponseState, [candidates])
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
    answer: answerSentences.join(' '),
  })
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

    const anchorLabel = matchingLabels[0]
    if (anchorLabel) {
      if (currentBlock) {
        blocks.push(currentBlock)
      }
      currentBlock = {
        text: paragraph.text,
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

  const verbal =
    /^(?<label>.+?)\s+(?<answer>(?:should|will|must|can|could|would|is|are|was|were|uses|use|means|requires|starts)\b.+)$/i.exec(
      trimmed,
    )?.groups
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
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map(normalizeSourceResponseText)
  const matchingIndexes = new Set<number>()

  for (const normalizedCandidate of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }
    const needle = ` ${normalizedCandidate} `

    sentences.forEach((sentence, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (` ${sentence.normalizedText} `.includes(needle)) {
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
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map(normalizeSourceResponseText)
  const matchingIndexes = new Set<number>()

  for (const normalizedCandidate of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }
    const needle = ` ${normalizedCandidate} `

    blocks.forEach((block, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (` ${block.normalizedQuestionText} `.includes(needle)) {
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
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map(normalizeSourceResponseText)
  const matchingIndexes = new Set<number>()

  for (const normalizedCandidate of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }
    const needle = ` ${normalizedCandidate} `

    spans.forEach((span, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (` ${span.normalizedQuestionText} `.includes(needle)) {
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
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map(normalizeSourceResponseText)
  const matchingIndexes = new Set<number>()

  for (const normalizedCandidate of normalizedCandidates) {
    if (!normalizedCandidate) {
      continue
    }
    const needle = ` ${normalizedCandidate} `

    paragraphs.forEach((paragraph, index) => {
      if (consumedIndexes.has(index)) {
        return
      }
      if (` ${paragraph.normalizedText} `.includes(needle)) {
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
  const normalizedCandidates = dedupeNonEmptyStrings(candidates).map(normalizeSourceResponseLabel)
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
    const needle = ` ${normalizedCandidate} `
    if (` ${normalizedText} `.includes(needle)) {
      matches.push(normalizedCandidate)
    }
  }
  return matches
}

function registerTopicBlockCandidates(
  sourceResponseState: InterpretedSourceResponseState | undefined,
  candidateGroups: string[][],
) {
  if (!sourceResponseState || sourceResponseState.sourceResponseFormat !== 'topic_blocks') {
    return
  }

  const candidateLabels = sourceResponseState.topicBlockCandidateLabels ?? new Set<string>()
  let changed = false
  for (const candidateGroup of candidateGroups) {
    for (const candidate of dedupeNonEmptyStrings(candidateGroup)) {
      const normalizedCandidate = normalizeSourceResponseLabel(candidate)
      if (candidateLabels.has(normalizedCandidate)) {
        continue
      }
      candidateLabels.add(normalizedCandidate)
      changed = true
    }
  }

  sourceResponseState.topicBlockCandidateLabels = candidateLabels
  if (changed) {
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

function humanizeDecisionKey(value: string | undefined) {
  return value?.trim().replace(/[_-]+/g, ' ')
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
