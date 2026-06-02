import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
} from '../storage/planningRequestStore'
import type { GoalPlanningBatchEntryInput } from './planningRequest'

export class AnswerInterpretationError extends Error {}

export type InterpretableSourceResponseFormat = 'labeled_sections' | 'ordered_items'

export interface InterpretedSourceResponseState {
  sourceResponse?: string
  sourceResponseFormat: InterpretableSourceResponseFormat
  labeledSections?: Map<string, string>
  orderedItems?: string[]
  nextOrderedItemIndex: number
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
  }
}

export function materializeInterpretedDecisionAnswers(
  answers: InterpretableDecisionAnswerEntryInput[],
  sourceResponse?: string,
  answerSources?: InterpretableAnswerSource[],
  sourceResponseFormat?: InterpretableSourceResponseFormat,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  const answerSourcesByKey = createAnswerSourceLookup(answerSources, sourceResponse)
  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)

  return answers.map((answer) => ({
    summary: answer.summary,
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
) {
  const explicitAnswers = answers ?? []
  if (inferOpenDecisions && explicitAnswers.some((answer) => !answer.decisionKey?.trim())) {
    throw new AnswerInterpretationError(
      'inferOpenDecisions requires every explicit answer entry to include decisionKey.',
    )
  }

  const materializedExplicitAnswers = materializeInterpretedDecisionAnswers(
    explicitAnswers,
    sourceResponse,
    answerSources,
    sourceResponseFormat,
    sourceResponseState,
  )

  const interpretationState =
    sourceResponseState ??
    createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
  const materializedAnswers = inferOpenDecisions
    ? [
        ...materializedExplicitAnswers,
        ...materializeMatchingOpenDecisionAnswers(
          openDecisions,
          new Set(
            materializedExplicitAnswers.flatMap((answer) =>
              answer.decisionKey ? [answer.decisionKey] : [],
            ),
          ),
          sourceResponse,
          sourceResponseFormat,
          interpretationState,
        ),
      ]
    : materializedExplicitAnswers

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
) {
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

function materializeMatchingOpenDecisionAnswers(
  openDecisions: InterpretableOpenDecision[],
  explicitDecisionKeys: Set<string>,
  sourceResponse: string | undefined,
  sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  sourceResponseState?: InterpretedSourceResponseState,
) {
  if (sourceResponseFormat !== 'labeled_sections' && sourceResponseFormat !== 'ordered_items') {
    throw new AnswerInterpretationError(
      'inferOpenDecisions requires sourceResponseFormat "labeled_sections" or "ordered_items".',
    )
  }

  const sectionsByLabel =
    sourceResponseFormat === 'labeled_sections'
      ? parseRequiredLabeledSourceResponseSections(
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
    const match =
      sourceResponseFormat === 'labeled_sections'
        ? findLabeledSourceResponseSection(
            sectionsByLabel ?? new Map<string, string>(),
            buildOpenDecisionSourceResponseCandidates(decision),
          )
        : resolveOrderedSourceResponseItem(
            sourceResponse,
            `decision answer ${decision.decisionKey}`,
            sourceResponseState,
          )
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

function findLabeledSourceResponseSection(
  sectionsByLabel: Map<string, string>,
  candidates: string[],
) {
  for (const candidate of candidates) {
    const match = sectionsByLabel.get(normalizeSourceResponseLabel(candidate))
    if (match) {
      return match
    }
  }
  return undefined
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

function parseLabeledSourceResponseSections(sourceResponse: string) {
  const sectionsByLabel = new Map<string, string>()
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
    sectionsByLabel.set(normalized, value)
  }
  return sectionsByLabel
}

function normalizeSourceResponseLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
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
