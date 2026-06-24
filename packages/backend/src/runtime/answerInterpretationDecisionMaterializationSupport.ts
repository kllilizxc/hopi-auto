import type { AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import {
  type PendingAnswerSourceConsumerDescriptor,
  type ResolvedAnswerSourceEntry,
  createResolvedAnswerSources,
  groupRemainingAnswerSourceEntries,
} from './answerInterpretationAnswerSourceSupport'
import type {
  DecisionBundleInput,
  DecisionMaterializationSupportDependencies,
} from './answerInterpretationDecisionMaterializationTypes'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import type {
  InterpretableAnswerSource,
  InterpretableDecisionAnswerEntryInput,
  InterpretableKnownDecision,
  InterpretableOpenDecision,
  MaterializedInterpretedDecisionAnswer,
} from './answerInterpretationPublicTypes'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
} from './answerInterpretationTypes'

export function createAnswerInterpretationDecisionMaterializationSupport(
  dependencies: DecisionMaterializationSupportDependencies,
) {
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
      return dependencies.finalizeMaterializedPlanningAnswers(answers, captureFormat)
    }
    return answers.map((answer) => dependencies.attachCaptureFormat(answer, captureFormat))
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

  function materializeMatchingOpenDecisionAnswers(
    openDecisions: InterpretableOpenDecision[],
    explicitDecisionKeys: Set<string>,
    sourceResponse: string | undefined,
    answerSources: InterpretableAnswerSource[] | undefined,
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    return finalizeMaterializedDecisionAnswers(
      dependencies.materializeMatchingOpenDecisionSurfaceAnswers(
        openDecisions,
        explicitDecisionKeys,
        sourceResponse,
        answerSources,
        sourceResponseFormat,
        sourceResponseState,
      ),
      sourceResponseFormat,
    )
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
      sourceResponseFormat === 'pending_answer_sources'
        ? resolvedAnswerSources?.entries
        : undefined
    const matchingAnswerSourceEntries =
      sourceResponseFormat === 'matching_answer_sources'
        ? resolvedAnswerSources?.entries
        : undefined

    if (sourceResponseFormat === 'pending_answer_sources') {
      const entries = dependencies.parseRequiredPendingAnswerSourceEntries(
        pendingAnswerSourceEntries,
        'inferDecisionTopics',
        sourceResponseState,
      )
      const groupedEntries = groupRemainingAnswerSourceEntries(
        entries.slice(sourceResponseState?.nextPendingAnswerSourceIndex ?? 0),
        new Set<number>(),
        'inferDecisionTopics',
        'pending',
        dependencies.resolveRemainingMatchingDecisionAnswerSourceGroupDescriptor,
      )
      if (sourceResponseState) {
        sourceResponseState.nextPendingAnswerSourceIndex = entries.length
      }
      return dependencies.materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
        groupedEntries.map((groupedEntry) => groupedEntry.entry),
        knownDecisions,
        'inferDecisionTopics',
      )
    }

    if (sourceResponseFormat === 'matching_answer_sources') {
      const entries = dependencies.parseRequiredMatchingAnswerSourceEntries(
        matchingAnswerSourceEntries,
        'inferDecisionTopics',
        sourceResponseState,
      )
      const consumedIndexes =
        sourceResponseState?.consumedMatchingAnswerSourceIndexes ?? new Set<number>()
      const groupedEntries = groupRemainingAnswerSourceEntries(
        entries,
        consumedIndexes,
        'inferDecisionTopics',
        'matching',
        dependencies.resolveRemainingMatchingDecisionAnswerSourceGroupDescriptor,
      )
      if (sourceResponseState) {
        for (const groupedEntry of groupedEntries) {
          for (const index of groupedEntry.indexes) {
            sourceResponseState.consumedMatchingAnswerSourceIndexes.add(index)
          }
        }
      }
      return dependencies.materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
        groupedEntries.map((groupedEntry) => groupedEntry.entry),
        knownDecisions,
        'inferDecisionTopics',
      )
    }

    const preparedDecisionTopicSurface = dependencies.prepareDecisionTopicSurface(
      sourceResponseFormat,
      sourceResponse,
      sourceResponseState,
    )
    dependencies.reservePreparedDecisionTopicSurfaceCandidates(
      preparedDecisionTopicSurface,
      explicitAnswers,
      openDecisions,
      inferOpenDecisions,
      reservedAnswerCandidateGroups,
    )
    return finalizeMaterializedDecisionAnswers(
      dependencies.materializePreparedDecisionTopicSurfaceAnswers(
        preparedDecisionTopicSurface,
        knownDecisions,
      ),
      sourceResponseFormat,
    )
  }

  function materializeInterpretedDecisionAnswers(
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
      dependencies.createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
    dependencies.registerTopicAnchorCandidates(interpretationState, [
      ...answers.map((answer) => dependencies.buildDecisionAnswerSourceResponseCandidates(answer)),
      ...additionalSourceResponseCandidates,
    ])
    dependencies.registerQuestionAnchorCandidateGroups(interpretationState, [
      ...answers.map((answer) => dependencies.buildDecisionAnswerSourceResponseCandidates(answer)),
      ...additionalSourceResponseCandidates,
    ])
    dependencies.registerMatchingRunCandidateGroups(interpretationState, [
      ...answers.map((answer) => dependencies.buildDecisionAnswerSourceResponseCandidates(answer)),
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
        dependencies.buildDecisionAnswerSourceResponseCandidates(answer),
        interpretationState,
        dependencies.buildDecisionPendingAnswerSourceConsumerDescriptor(answer),
        rejectMultipleInferredTopicSummariesInTopicUnits,
      )
      return dependencies.attachCaptureFormat(
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

  function materializeInterpretedDecisionAnswerBatch(
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
      dependencies.createInterpretedSourceResponseState(sourceResponse, sourceResponseFormat)
    const reservedAnswerCandidateGroups =
      dependencies.normalizeReservedAnswerCandidateGroups(reservedAnswerCandidates)
    dependencies.registerTopicAnchorCandidates(interpretationState, [
      ...explicitAnswers.map((answer) =>
        dependencies.buildDecisionAnswerSourceResponseCandidates(answer),
      ),
      ...openDecisions.map((decision) =>
        dependencies.buildOpenDecisionSourceResponseCandidates(decision),
      ),
      ...knownDecisions.map((decision) =>
        dependencies.buildKnownDecisionSourceResponseCandidates(decision),
      ),
      ...reservedAnswerCandidateGroups,
    ])
    dependencies.registerQuestionAnchorCandidateGroups(interpretationState, [
      ...explicitAnswers.map((answer) =>
        dependencies.buildDecisionAnswerSourceResponseCandidates(answer),
      ),
      ...openDecisions.map((decision) =>
        dependencies.buildOpenDecisionSourceResponseCandidates(decision),
      ),
      ...knownDecisions.map((decision) =>
        dependencies.buildKnownDecisionSourceResponseCandidates(decision),
      ),
      ...reservedAnswerCandidateGroups,
    ])
    dependencies.registerMatchingRunCandidateGroups(interpretationState, [
      ...explicitAnswers.map((answer) =>
        dependencies.buildDecisionAnswerSourceResponseCandidates(answer),
      ),
      ...openDecisions.map((decision) =>
        dependencies.buildOpenDecisionSourceResponseCandidates(decision),
      ),
      ...knownDecisions.map((decision) =>
        dependencies.buildKnownDecisionSourceResponseCandidates(decision),
      ),
      ...reservedAnswerCandidateGroups,
    ])
    const materializedExplicitAnswers = materializeInterpretedDecisionAnswers(
      explicitAnswers,
      sourceResponse,
      answerSources,
      sourceResponseFormat,
      interpretationState,
      [
        ...openDecisions.map((decision) =>
          dependencies.buildOpenDecisionSourceResponseCandidates(decision),
        ),
        ...knownDecisions.map((decision) =>
          dependencies.buildKnownDecisionSourceResponseCandidates(decision),
        ),
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
        const labeledSections = dependencies.parseRequiredLabeledSourceResponseSections(
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
        const labeledSections = dependencies.parseRequiredLabeledSourceResponseSections(
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
        const inlineTopics = dependencies.parseRequiredInlineTopicSections(
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
        const inlineTopics = dependencies.parseRequiredInlineTopicSections(
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
        dependencies.throwSpecificOpenDecisionSurfaceNoMatchError(
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

  function materializeInterpretedDecisionBundle(input: DecisionBundleInput) {
    const resolvedSourceResponseFormat = dependencies.resolveAutoSourceResponseFormat(
      input.sourceResponseFormat,
      dependencies.listAutoSourceResponseFormatCandidates({
        hasSourceResponse: Boolean(input.sourceResponse?.trim()),
        hasAnswerSources: Boolean(input.answerSources?.length),
        needsExplicitAnswerInterpretation:
          (input.answers?.length ?? 0) > 0 ||
          dependencies.listInterpretableFollowThroughAnswerSummaries(input.followThrough).length >
            0,
        inferOpenDecisions: input.inferOpenDecisions,
        inferDecisionTopics: input.inferDecisionTopics ?? false,
        inferRemainingAnswers: dependencies.followThroughInfersRemainingAnswers(
          input.followThrough,
        ),
        sourceResponse: input.sourceResponse,
      }),
      (candidateFormat) => {
        const state = dependencies.createInterpretedSourceResponseState(
          input.sourceResponse,
          candidateFormat,
        )
        const mixedRemainingAnswerSourceInference =
          dependencies.hasMixedRemainingAnswerSourceInference(input)
        dependencies.assertAutoDidNotSkipMalformedExplicitInlineTopicAuthority(input.sourceResponse)
        try {
          if (
            mixedRemainingAnswerSourceInference &&
            !dependencies.supportsMixedRemainingAnswerSourceInference(candidateFormat)
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
            dependencies.materializeInterpretedDecisionFollowThrough(
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
            dependencies.materializeMixedRemainingAnswerSourceInference({
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
            dependencies.materializeInterpretedDecisionFollowThrough(
              input.followThrough,
              input.sourceResponse,
              input.answerSources,
              candidateFormat,
              state,
              false,
            )
          }
          if (candidateFormat === 'inline_topics') {
            dependencies.assertDirectLabelFamilySourceResponseCompleteness({
              sourceResponse: input.sourceResponse,
              sourceResponseFormat: candidateFormat,
              sourceResponseState: state,
              label: 'sourceResponseFormat auto',
            })
          }
          dependencies.assertAutoSourceResponseFormatCompleteness({
            sourceResponse: input.sourceResponse,
            answerSources: input.answerSources,
            sourceResponseFormat: candidateFormat,
            sourceResponseState: state,
            inferDecisionTopics: input.inferDecisionTopics ?? false,
            inferRemainingAnswers: dependencies.followThroughInfersRemainingAnswers(
              input.followThrough,
            ),
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
      'decision answer bundle',
    )
    const state = dependencies.createInterpretedSourceResponseState(
      input.sourceResponse,
      resolvedSourceResponseFormat,
    )
    const mixedRemainingAnswerSourceInference =
      dependencies.hasMixedRemainingAnswerSourceInference(input)
    if (
      mixedRemainingAnswerSourceInference &&
      (!resolvedSourceResponseFormat ||
        !dependencies.supportsMixedRemainingAnswerSourceInference(resolvedSourceResponseFormat))
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
      const explicitFollowThrough = dependencies.materializeInterpretedDecisionFollowThrough(
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
      const inferred = dependencies.materializeMixedRemainingAnswerSourceInference({
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
                answers: explicitFollowThrough.answers
                  ? [...explicitFollowThrough.answers, ...inferred.planningAnswers]
                  : inferred.planningAnswers,
              }
            : {
                ...explicitFollowThrough,
                inferRemainingAnswers: true,
                answers: explicitFollowThrough.answers
                  ? [...explicitFollowThrough.answers, ...inferred.planningAnswers]
                  : inferred.planningAnswers,
              }
          : explicitFollowThrough && input.followThrough
            ? {
                ...explicitFollowThrough,
                inferRemainingAnswers: input.followThrough.inferRemainingAnswers,
              }
            : explicitFollowThrough

      dependencies.assertNoUnusedExplicitlyRoutedAnswerSources({
        sourceResponse: input.sourceResponse,
        answerSources: input.answerSources,
        sourceResponseFormat: resolvedSourceResponseFormat,
        sourceResponseState: state,
        label: 'decision answer bundle',
      })
      assertDirectSourceResponseCompleteness(
        'decision answer bundle',
        input.sourceResponse,
        input.answerSources,
        resolvedSourceResponseFormat,
        state,
      )

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
    const followThrough = dependencies.materializeInterpretedDecisionFollowThrough(
      input.followThrough,
      input.sourceResponse,
      input.answerSources,
      resolvedSourceResponseFormat,
      state,
      false,
    )
    dependencies.assertNoUnusedExplicitlyRoutedAnswerSources({
      sourceResponse: input.sourceResponse,
      answerSources: input.answerSources,
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      label: 'decision answer bundle',
    })
    assertDirectSourceResponseCompleteness(
      'decision answer bundle',
      input.sourceResponse,
      input.answerSources,
      resolvedSourceResponseFormat,
      state,
    )

    return {
      sourceResponseFormat: resolvedSourceResponseFormat,
      sourceResponseState: state,
      answers,
      followThrough,
    }
  }

  return {
    materializeInterpretedDecisionAnswerBatch,
    materializeInterpretedDecisionAnswers,
    materializeInterpretedDecisionBundle,
  }
}
