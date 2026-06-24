import type { AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import type {
  GoalPlanningRequestAnswer,
  GoalPlanningRequestUpdateTarget,
} from '../storage/planningRequestStore'
import {
  type PendingAnswerSourceConsumerDescriptor,
  type RemainingAnswerSourceGroupDescriptor,
  type ResolvedAnswerSourceEntry,
  createResolvedAnswerSources,
  groupRemainingAnswerSourceEntries,
} from './answerInterpretationAnswerSourceSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import type { PreparedRemainingPlanningSurface } from './answerInterpretationRemainingPlanningSurfaceSupport'
import type {
  InterpretableAnswerSource,
  InterpretableDecisionFollowThroughInput,
  InterpretableDecisionWorkflowLeafFollowThroughInput,
  InterpretablePlanningWorkflowLeafCarrier,
  InterpretablePlanningAnswer,
  MaterializedPlanningAnswerCarrier,
  MaterializedPlanningWorkflowBatchCarrier,
} from './answerInterpretationPublicTypes'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
  ResolvedAnswerContent,
} from './answerInterpretationTypes'
import type { GoalPlanningBatchEntryInput } from './planningRequest'

type ConcreteInterpretableSourceResponseFormat = AnswerCaptureFormat

interface PlanningMaterializationSupportDependencies {
  assertAutoPlanningDidNotSkipUnsupportedExplicitLabelAuthority: (
    followThrough: InterpretableDecisionFollowThroughInput,
    sourceResponse: string | undefined,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => void
  assertAutoSourceResponseFormatCompleteness: (input: {
    sourceResponse?: string
    answerSources?: InterpretableAnswerSource[]
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat
    sourceResponseState: InterpretedSourceResponseState | undefined
  }) => void
  assertAutoSourceResponseFormatDidNotStopAtWeakerInlineTopics: (
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => void
  assertDirectAnswerSourceFamilySourceResponseCompleteness: (input: {
    sourceResponse?: string
    answerSources?: InterpretableAnswerSource[]
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectLabelFamilySourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectMatchingRunSourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectOrderedSourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectPendingSourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertDirectQuestionAndTopicSourceResponseCompleteness: (input: {
    sourceResponse?: string
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  assertNoUnusedExplicitlyRoutedAnswerSources: (input: {
    sourceResponse?: string
    answerSources?: InterpretableAnswerSource[]
    sourceResponseFormat?: InterpretableSourceResponseFormat
    sourceResponseState?: InterpretedSourceResponseState
    label: string
  }) => void
  buildPlanningAnswerSourceResponseCandidates: (answer: InterpretablePlanningAnswer) => string[]
  buildPlanningPendingAnswerSourceConsumerDescriptor: (
    answer: InterpretablePlanningAnswer,
  ) => PendingAnswerSourceConsumerDescriptor
  createAutoSourceResponseTerminalError: (message: string) => Error
  createInterpretedSourceResponseState: (
    sourceResponse?: string,
    sourceResponseFormat?: InterpretableSourceResponseFormat,
  ) => InterpretedSourceResponseState | undefined
  followThroughInfersRemainingAnswers: (
    followThrough: InterpretableDecisionFollowThroughInput | undefined,
  ) => boolean
  isTerminalLabelFamilyAutoProbeError: (
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    error: unknown,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => boolean
  listAutoSourceResponseFormatCandidates: (input: {
    hasSourceResponse: boolean
    hasAnswerSources: boolean
    needsExplicitAnswerInterpretation: boolean
    inferRemainingAnswers: boolean
    sourceResponse?: string
  }) => ConcreteInterpretableSourceResponseFormat[]
  listInterpretableFollowThroughAnswerCandidateGroups: (
    followThrough: InterpretableDecisionFollowThroughInput,
  ) => string[][]
  listInterpretableFollowThroughAnswerSummaries: (
    followThrough: InterpretableDecisionFollowThroughInput,
  ) => string[]
  materializeRemainingPlanningAnswerFromAnswerSourceEntry: (
    entry: ResolvedAnswerSourceEntry,
    label: string,
    captureFormat?: AnswerCaptureFormat,
  ) => GoalPlanningRequestAnswer
  materializeRemainingPlanningSurfaceAnswers: (
    preparedRemainingPlanningSurface: PreparedRemainingPlanningSurface,
  ) => GoalPlanningRequestAnswer[]
  parseRequiredMatchingAnswerSourceEntries: (
    answerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => ResolvedAnswerSourceEntry[]
  parseRequiredPendingAnswerSourceEntries: (
    answerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => ResolvedAnswerSourceEntry[]
  prepareRemainingPlanningSurface: (
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponse: string | undefined,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => PreparedRemainingPlanningSurface
  registerMatchingRunCandidateGroups: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) => void
  registerQuestionAnchorCandidateGroups: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) => void
  registerTopicAnchorCandidates: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) => void
  resolveAutoSourceResponseFormat: (
    requestedSourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    candidateSourceResponseFormats: ConcreteInterpretableSourceResponseFormat[],
    validateCandidate: (sourceResponseFormat: ConcreteInterpretableSourceResponseFormat) => void,
    label: string,
  ) => ConcreteInterpretableSourceResponseFormat | undefined
  resolveRemainingMatchingPlanningAnswerSourceGroupDescriptor: (
    entry: ResolvedAnswerSourceEntry,
  ) => RemainingAnswerSourceGroupDescriptor | undefined
  resolveStructuredAnswerContent: (
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
    sourceResponseCandidates?: string[],
    sourceResponseState?: InterpretedSourceResponseState,
    pendingAnswerSourceConsumerDescriptor?: PendingAnswerSourceConsumerDescriptor,
    rejectMultipleInferredTopicSummariesInTopicUnits?: boolean,
  ) => ResolvedAnswerContent
  shouldAutoSourceResponseProbeFailClosed: (
    sourceResponseFormat: ConcreteInterpretableSourceResponseFormat,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) => boolean
}

export function createAnswerInterpretationPlanningMaterializationSupport(
  dependencies: PlanningMaterializationSupportDependencies,
) {
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

  function toAnswerCaptureFormat(
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  ): AnswerCaptureFormat | undefined {
    if (!sourceResponseFormat || sourceResponseFormat === 'auto') {
      return undefined
    }
    return sourceResponseFormat
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

  function mergeMaterializedPlanningAnswers(
    explicitAnswers: GoalPlanningRequestAnswer[] | undefined,
    inferredAnswers: GoalPlanningRequestAnswer[],
  ) {
    if (!explicitAnswers && inferredAnswers.length === 0) {
      return undefined
    }

    return [...(explicitAnswers ?? []), ...inferredAnswers]
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
  ) {
    return dependencies.resolveStructuredAnswerContent(
      answer,
      sourceExcerpt,
      sourceOccurrence,
      answerSourceKey,
      answerSourceGroupKey,
      sourceResponse,
      label,
      answerSourcesByKey,
      answerSourceGroupsByKey,
      pendingAnswerSourceEntries,
      matchingAnswerSourceEntries,
      sourceResponseFormat,
      sourceResponseCandidates,
      sourceResponseState,
      pendingAnswerSourceConsumerDescriptor,
      rejectMultipleInferredTopicSummariesInTopicUnits,
    )
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
      dependencies.createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)

    if (sourceResponseFormat === 'pending_answer_sources') {
      const entries = dependencies.parseRequiredPendingAnswerSourceEntries(
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
        dependencies.resolveRemainingMatchingPlanningAnswerSourceGroupDescriptor,
      )
      const answers = groupedEntries.map((groupedEntry) =>
        dependencies.materializeRemainingPlanningAnswerFromAnswerSourceEntry(
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
      const entries = dependencies.parseRequiredMatchingAnswerSourceEntries(
        matchingAnswerSourceEntries,
        'followThrough.inferRemainingAnswers',
        interpretationState,
      )
      const consumedIndexes =
        interpretationState?.consumedMatchingAnswerSourceIndexes ?? new Set<number>()
      const groupedEntries = groupRemainingAnswerSourceEntries(
        entries,
        consumedIndexes,
        'followThrough.inferRemainingAnswers',
        'matching',
        dependencies.resolveRemainingMatchingPlanningAnswerSourceGroupDescriptor,
      )
      const answers: GoalPlanningRequestAnswer[] = []
      for (const groupedEntry of groupedEntries) {
        if (interpretationState) {
          for (const index of groupedEntry.indexes) {
            interpretationState.consumedMatchingAnswerSourceIndexes.add(index)
          }
        }
        answers.push(
          dependencies.materializeRemainingPlanningAnswerFromAnswerSourceEntry(
            groupedEntry.entry,
            'followThrough.inferRemainingAnswers',
            captureFormat,
          ),
        )
      }
      return finalizeMaterializedPlanningAnswers(answers, captureFormat)
    }

    const preparedRemainingPlanningSurface = dependencies.prepareRemainingPlanningSurface(
      sourceResponseFormat,
      sourceResponse,
      interpretationState,
    )
    return finalizeMaterializedPlanningAnswers(
      dependencies.materializeRemainingPlanningSurfaceAnswers(preparedRemainingPlanningSurface),
      captureFormat,
    )
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
      dependencies.createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
    const explicitAnswers = answers ?? []
    dependencies.registerTopicAnchorCandidates(interpretationState, [
      ...explicitAnswers.map((answer) =>
        dependencies.buildPlanningAnswerSourceResponseCandidates(answer),
      ),
    ])
    dependencies.registerQuestionAnchorCandidateGroups(interpretationState, [
      ...explicitAnswers.map((answer) =>
        dependencies.buildPlanningAnswerSourceResponseCandidates(answer),
      ),
    ])
    dependencies.registerMatchingRunCandidateGroups(interpretationState, [
      ...explicitAnswers.map((answer) =>
        dependencies.buildPlanningAnswerSourceResponseCandidates(answer),
      ),
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
        dependencies.buildPlanningAnswerSourceResponseCandidates(answer),
        interpretationState,
        dependencies.buildPlanningPendingAnswerSourceConsumerDescriptor(answer),
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

  function assertDirectSourceResponseCompleteness(
    label: string,
    sourceResponse: string | undefined,
    answerSources: InterpretableAnswerSource[] | undefined,
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponseState: InterpretedSourceResponseState | undefined,
  ) {
    dependencies.assertDirectAnswerSourceFamilySourceResponseCompleteness({
      sourceResponse,
      answerSources,
      sourceResponseFormat,
      sourceResponseState,
      label,
    })
    dependencies.assertDirectMatchingRunSourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState,
      label,
    })
    dependencies.assertDirectLabelFamilySourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState,
      label,
    })
    dependencies.assertDirectQuestionAndTopicSourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState,
      label,
    })
    dependencies.assertDirectOrderedSourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState,
      label,
    })
    dependencies.assertDirectPendingSourceResponseCompleteness({
      sourceResponse,
      sourceResponseFormat,
      sourceResponseState,
      label,
    })
  }

  function materializeInterpretedDecisionFollowThrough(
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
      dependencies.createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
    dependencies.registerTopicAnchorCandidates(interpretationState, [
      ...dependencies.listInterpretableFollowThroughAnswerCandidateGroups(followThrough),
    ])
    dependencies.registerQuestionAnchorCandidateGroups(interpretationState, [
      ...dependencies.listInterpretableFollowThroughAnswerCandidateGroups(followThrough),
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
        assertDirectSourceResponseCompleteness(
          `followThrough "${followThrough.title}"`,
          sourceResponse,
          answerSources,
          sourceResponseFormat,
          interpretationState,
        )
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
        assertDirectSourceResponseCompleteness(
          `followThrough batch "${followThrough.groupKey}"`,
          sourceResponse,
          answerSources,
          sourceResponseFormat,
          interpretationState,
        )
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

    const workflows = followThrough.workflows.map((workflow) => ({
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
    }))

    const workflowKey = followThrough.workflowKey ?? 'workflow_batch'
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
      assertDirectSourceResponseCompleteness(
        `followThrough workflow batch "${workflowKey}"`,
        sourceResponse,
        answerSources,
        sourceResponseFormat,
        interpretationState,
      )
    }

    return materialized
  }

  function resolveAutoPlanningSourceResponseFormat(
    followThrough: InterpretableDecisionFollowThroughInput,
    sourceResponse?: string,
    answerSources?: InterpretableAnswerSource[],
    sourceResponseFormat?: InterpretableSourceResponseFormat,
  ) {
    return dependencies.resolveAutoSourceResponseFormat(
      sourceResponseFormat,
      dependencies.listAutoSourceResponseFormatCandidates({
        hasSourceResponse: Boolean(sourceResponse?.trim()),
        hasAnswerSources: Boolean(answerSources?.length),
        needsExplicitAnswerInterpretation:
          dependencies.listInterpretableFollowThroughAnswerSummaries(followThrough).length > 0,
        inferRemainingAnswers: dependencies.followThroughInfersRemainingAnswers(followThrough),
        sourceResponse,
      }),
      (candidateFormat) => {
        const state = dependencies.createInterpretedSourceResponseState(
          sourceResponse,
          candidateFormat,
        )
        dependencies.assertAutoPlanningDidNotSkipUnsupportedExplicitLabelAuthority(
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
            dependencies.assertDirectLabelFamilySourceResponseCompleteness({
              sourceResponse,
              sourceResponseFormat: candidateFormat,
              sourceResponseState: state,
              label: 'sourceResponseFormat auto',
            })
          }
          dependencies.assertAutoSourceResponseFormatCompleteness({
            sourceResponse,
            answerSources,
            sourceResponseFormat: candidateFormat,
            sourceResponseState: state,
          })
          dependencies.assertAutoSourceResponseFormatDidNotStopAtWeakerInlineTopics(
            candidateFormat,
            state,
          )
        } catch (error) {
          if (dependencies.isTerminalLabelFamilyAutoProbeError(candidateFormat, error, state)) {
            throw dependencies.createAutoSourceResponseTerminalError(
              error instanceof Error ? error.message : String(error),
            )
          }
          if (dependencies.shouldAutoSourceResponseProbeFailClosed(candidateFormat, state)) {
            throw dependencies.createAutoSourceResponseTerminalError(
              error instanceof Error ? error.message : String(error),
            )
          }
          throw error
        }
      },
      followThrough.kind,
    )
  }

  function materializeInterpretedPlanningInput<
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
      dependencies.createInterpretedSourceResponseState(sourceResponse, resolvedSourceResponseFormat)
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
    dependencies.assertNoUnusedExplicitlyRoutedAnswerSources({
      sourceResponse,
      answerSources,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: interpretationState,
      label: `planning input "${input.title}"`,
    })
    assertDirectSourceResponseCompleteness(
      `planning input "${input.title}"`,
      sourceResponse,
      answerSources,
      resolvedSourceResponseFormat,
      interpretationState,
    )

    return {
      ...input,
      answers: materialized.answers,
      resolvedSourceResponseFormat,
    }
  }

  function materializeInterpretedPlanningBatchInput<
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
      dependencies.createInterpretedSourceResponseState(sourceResponse, resolvedSourceResponseFormat)
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
    dependencies.assertNoUnusedExplicitlyRoutedAnswerSources({
      sourceResponse,
      answerSources,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: interpretationState,
      label: `planning batch "${input.groupKey}"`,
    })
    assertDirectSourceResponseCompleteness(
      `planning batch "${input.groupKey}"`,
      sourceResponse,
      answerSources,
      resolvedSourceResponseFormat,
      interpretationState,
    )

    return {
      ...input,
      answers: materialized.answers,
      resolvedSourceResponseFormat,
    }
  }

  function materializeInterpretedPlanningWorkflowBatchInput<
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
      dependencies.createInterpretedSourceResponseState(sourceResponse, resolvedSourceResponseFormat)
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
    const workflowKey = input.workflowKey ?? 'workflow_batch'
    dependencies.assertNoUnusedExplicitlyRoutedAnswerSources({
      sourceResponse,
      answerSources,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: interpretationState,
      label: `planning workflow batch "${workflowKey}"`,
    })
    assertDirectSourceResponseCompleteness(
      `planning workflow batch "${workflowKey}"`,
      sourceResponse,
      answerSources,
      resolvedSourceResponseFormat,
      interpretationState,
    )

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

  return {
    attachCaptureFormat,
    finalizeMaterializedPlanningAnswers,
    materializeInterpretedDecisionFollowThrough,
    materializeInterpretedPlanningAnswers,
    materializeInterpretedPlanningBatchInput,
    materializeInterpretedPlanningInput,
    materializeInterpretedPlanningWorkflowBatchInput,
    materializeRemainingInterpretedPlanningAnswers,
    mergeMaterializedPlanningAnswers,
    resolveAutoPlanningSourceResponseFormat,
  }
}
