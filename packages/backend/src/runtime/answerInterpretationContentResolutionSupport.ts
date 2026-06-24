import type { AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import { synthesizeCanonicalPromptFromSummary } from '../domain/canonicalPrompt'
import type { GoalPlanningRequestAnswer } from '../storage/planningRequestStore'
import {
  type InterpretableAnswerSourceInput,
  type PendingAnswerSourceConsumerDescriptor,
  type RemainingAnswerSourceRoute,
  type ResolvedAnswerSourceEntry,
  createResolvedAnswerSources,
  entryHasPendingAnswerSourceGroupingAuthority,
  entryMatchesPendingAnswerSourceConsumer,
  findMatchingAnswerSourceEntryIndexes,
  findNonContiguousPendingAnswerSourceAuthority,
  formatPendingAnswerSourceAuthorityLabels,
  groupMixedRemainingAnswerSourceEntries,
  listPendingAnswerSourceEntryAuthorities,
} from './answerInterpretationAnswerSourceSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import {
  resolveContiguousMatchedValues,
  resolveIndexedParsedValue,
  resolveMatchingRunText,
  resolveStructuredSectionValue,
} from './answerInterpretationSelectionSupport'
import type {
  InterpretableSourceResponseFormat,
  InterpretedSourceResponseState,
  LabeledSourceResponseSection,
  MatchingSourceResponseRun,
} from './answerInterpretationTypes'

type ParsedStringListParser = (
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => string[]

type ParsedSectionMapParser = (
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => Map<string, LabeledSourceResponseSection>

type ParsedAnswerSourceEntryParser = (
  answerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => ResolvedAnswerSourceEntry[]

type MatchingRunParser = (
  sourceResponse: string | undefined,
  label: string,
  sourceResponseState?: InterpretedSourceResponseState,
) => MatchingSourceResponseRun[]

interface ContentResolutionSupportDependencies<TKnownDecision, TDecisionAnswer> {
  assertLabeledValueAuthorityMatchesLabel: (
    label: string,
    value: string,
    unitLabel: string,
    valueLabel: string,
  ) => void
  createInterpretedSourceResponseState: (
    sourceResponse?: string,
    sourceResponseFormat?: InterpretableSourceResponseFormat,
  ) => InterpretedSourceResponseState | undefined
  findLabeledSourceResponseSectionEntry: (
    sectionsByLabel: Map<string, LabeledSourceResponseSection>,
    candidates: string[],
    consumedLabels?: Set<string>,
  ) => LabeledSourceResponseSection | undefined
  inferSummaryKeyFromStableAnswerSourceKey: (key: string | undefined) => string | undefined
  materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries: (
    entries: ResolvedAnswerSourceEntry[],
    knownDecisions: TKnownDecision[],
    label: string,
    captureFormat?: AnswerCaptureFormat,
  ) => TDecisionAnswer[]
  normalizeGenericPendingOrMatchingUnitText: (text: string) => string
  parseMatchingClosingSourceResponseRuns: MatchingRunParser
  parseMatchingMiddleSourceResponseRuns: MatchingRunParser
  parseMatchingOpeningSourceResponseRuns: MatchingRunParser
  parseMatchingSourceResponseRuns: MatchingRunParser
  parseRequiredInlineTopicSections: ParsedSectionMapParser
  parseRequiredLabeledSourceResponseSections: ParsedSectionMapParser
  parseRequiredMatchingAnswerSourceEntries: ParsedAnswerSourceEntryParser
  parseRequiredPendingAnswerSourceEntries: ParsedAnswerSourceEntryParser
  parseRequiredPendingSourceResponseClauses: ParsedStringListParser
  parseRequiredPendingSourceResponseConjunctions: ParsedStringListParser
  parseRequiredPendingSourceResponseParagraphs: ParsedStringListParser
  parseRequiredPendingSourceResponseSentences: ParsedStringListParser
  registerMatchingRunCandidateGroups: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) => void
  resolveMatchingRunCandidateGroupKey: (candidates: string[]) => string | undefined
  resolveRequiredAnswerSourceSummary: (entry: ResolvedAnswerSourceEntry, label: string) => string
  shouldDeriveSummaryKeyFromAnswerSourceKey: (entry: ResolvedAnswerSourceEntry) => boolean
  supportsMixedRemainingAnswerSourceInference: (
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined,
  ) => boolean
}

export function createAnswerInterpretationContentResolutionSupport<TKnownDecision, TDecisionAnswer>(
  dependencies: ContentResolutionSupportDependencies<TKnownDecision, TDecisionAnswer>,
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

  function resolveLabeledSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    return resolveStructuredSectionValue({
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      parseSections: dependencies.parseRequiredLabeledSourceResponseSections,
      consumedLabels: sourceResponseState?.consumedLabeledSectionLabels,
      findMatch: dependencies.findLabeledSourceResponseSectionEntry,
      assertMatch: (match) =>
        dependencies.assertLabeledValueAuthorityMatchesLabel(
          match.label,
          match.value,
          'Labeled section',
          'value text',
        ),
      missingMessage: `No labeled section matched ${label} in sourceResponse.`,
    })
  }

  function resolveInlineTopicSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    return resolveStructuredSectionValue({
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      parseSections: dependencies.parseRequiredInlineTopicSections,
      consumedLabels: sourceResponseState?.consumedInlineTopicLabels,
      findMatch: dependencies.findLabeledSourceResponseSectionEntry,
      assertMatch: (match) =>
        dependencies.assertLabeledValueAuthorityMatchesLabel(
          match.label,
          match.value,
          'Inline topic clause',
          'answer text',
        ),
      missingMessage: `No inline topic clause matched ${label} in sourceResponse.`,
    })
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
    const normalizedShared = shared
      ? dependencies.normalizeGenericPendingOrMatchingUnitText(shared)
      : undefined
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
    return resolveIndexedParsedValue({
      sourceResponse,
      label,
      parseValues: dependencies.parseRequiredPendingSourceResponseClauses,
      sourceResponseState,
      index: sourceResponseState?.nextPendingClauseIndex ?? 0,
      missingMessage: `No pending clause remained for ${label} in sourceResponse.`,
      onConsume: sourceResponseState
        ? (nextIndex) => {
            sourceResponseState.nextPendingClauseIndex = nextIndex
          }
        : undefined,
    })
  }

  function resolvePendingSourceResponseParagraph(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    return resolveIndexedParsedValue({
      sourceResponse,
      label,
      parseValues: dependencies.parseRequiredPendingSourceResponseParagraphs,
      sourceResponseState,
      index: sourceResponseState?.nextPendingParagraphIndex ?? 0,
      missingMessage: `No pending paragraph remained for ${label} in sourceResponse.`,
      onConsume: sourceResponseState
        ? (nextIndex) => {
            sourceResponseState.nextPendingParagraphIndex = nextIndex
          }
        : undefined,
    })
  }

  function resolvePendingSourceResponseSentence(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    return resolveIndexedParsedValue({
      sourceResponse,
      label,
      parseValues: dependencies.parseRequiredPendingSourceResponseSentences,
      sourceResponseState,
      index: sourceResponseState?.nextPendingSentenceIndex ?? 0,
      missingMessage: `No pending sentence remained for ${label} in sourceResponse.`,
      onConsume: sourceResponseState
        ? (nextIndex) => {
            sourceResponseState.nextPendingSentenceIndex = nextIndex
          }
        : undefined,
    })
  }

  function resolvePendingSourceResponseConjunction(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    return resolveIndexedParsedValue({
      sourceResponse,
      label,
      parseValues: dependencies.parseRequiredPendingSourceResponseConjunctions,
      sourceResponseState,
      index: sourceResponseState?.nextPendingConjunctionIndex ?? 0,
      missingMessage: `No pending conjunction segment remained for ${label} in sourceResponse.`,
      onConsume: sourceResponseState
        ? (nextIndex) => {
            sourceResponseState.nextPendingConjunctionIndex = nextIndex
          }
        : undefined,
    })
  }

  function resolvePendingAnswerSourceValue(
    pendingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
    consumerDescriptor?: PendingAnswerSourceConsumerDescriptor,
  ) {
    const entries = dependencies.parseRequiredPendingAnswerSourceEntries(
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
    const summary = dependencies.resolveRequiredAnswerSourceSummary(entry, label)
    const inferredSummaryKey = dependencies.shouldDeriveSummaryKeyFromAnswerSourceKey(entry)
      ? dependencies.inferSummaryKeyFromStableAnswerSourceKey(entry.key)
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
    const entries = dependencies.parseRequiredMatchingAnswerSourceEntries(
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
    return resolveContiguousMatchedValues({
      items: entries,
      matchingIndexes,
      missingMessage: `No answerSource matched ${label}.`,
      multipleMessage: `Multiple answerSources matched ${label}.`,
      onConsume: sourceResponseState
        ? (index) => {
            sourceResponseState.consumedMatchingAnswerSourceIndexes.add(index)
          }
        : undefined,
    })
  }

  function resolveMatchingRunSourceResponseValue(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const runs = dependencies.parseMatchingSourceResponseRuns(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const candidateGroupIndex = resolveMatchingRunCandidateGroupIndex(
      candidates,
      label,
      sourceResponseState,
    )
    return resolveMatchingRunText({
      runs,
      candidateGroupIndex,
      consumedIndexes: sourceResponseState?.consumedMatchingRunIndexes ?? new Set<number>(),
      missingMessage: `No matching run matched ${label} in sourceResponse.`,
      multipleMessage: `Multiple matching runs matched ${label}.`,
      onConsume: sourceResponseState
        ? (index) => {
            sourceResponseState.consumedMatchingRunIndexes.add(index)
          }
        : undefined,
    })
  }

  function resolveMatchingOpeningRunSourceResponseValue(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const runs = dependencies.parseMatchingOpeningSourceResponseRuns(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const candidateGroupIndex = resolveMatchingRunCandidateGroupIndex(
      candidates,
      label,
      sourceResponseState,
    )
    return resolveMatchingRunText({
      runs,
      candidateGroupIndex,
      consumedIndexes: sourceResponseState?.consumedMatchingOpeningRunIndexes ?? new Set<number>(),
      missingMessage: `No matching opening run matched ${label} in sourceResponse.`,
      multipleMessage: `Multiple matching opening runs matched ${label}.`,
      onConsume: sourceResponseState
        ? (index) => {
            sourceResponseState.consumedMatchingOpeningRunIndexes.add(index)
          }
        : undefined,
    })
  }

  function resolveMatchingClosingRunSourceResponseValue(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const runs = dependencies.parseMatchingClosingSourceResponseRuns(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const candidateGroupIndex = resolveMatchingRunCandidateGroupIndex(
      candidates,
      label,
      sourceResponseState,
    )
    return resolveMatchingRunText({
      runs,
      candidateGroupIndex,
      consumedIndexes: sourceResponseState?.consumedMatchingClosingRunIndexes ?? new Set<number>(),
      missingMessage: `No matching closing run matched ${label} in sourceResponse.`,
      multipleMessage: `Multiple matching closing runs matched ${label}.`,
      onConsume: sourceResponseState
        ? (index) => {
            sourceResponseState.consumedMatchingClosingRunIndexes.add(index)
          }
        : undefined,
    })
  }

  function resolveMatchingMiddleRunSourceResponseValue(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const runs = dependencies.parseMatchingMiddleSourceResponseRuns(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const candidateGroupIndex = resolveMatchingRunCandidateGroupIndex(
      candidates,
      label,
      sourceResponseState,
    )
    return resolveMatchingRunText({
      runs,
      candidateGroupIndex,
      consumedIndexes: sourceResponseState?.consumedMatchingMiddleRunIndexes ?? new Set<number>(),
      missingMessage: `No matching middle run matched ${label} in sourceResponse.`,
      multipleMessage: `Multiple matching middle runs matched ${label}.`,
      onConsume: sourceResponseState
        ? (index) => {
            sourceResponseState.consumedMatchingMiddleRunIndexes.add(index)
          }
        : undefined,
    })
  }

  function materializeMixedRemainingAnswerSourceInference(input: {
    sourceResponse?: string
    answerSources?: InterpretableAnswerSourceInput[]
    sourceResponseFormat: InterpretableSourceResponseFormat | undefined
    sourceResponseState: InterpretedSourceResponseState | undefined
    knownDecisions: TKnownDecision[]
  }) {
    const captureFormat = toAnswerCaptureFormat(input.sourceResponseFormat)
    if (!dependencies.supportsMixedRemainingAnswerSourceInference(input.sourceResponseFormat)) {
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
      dependencies.createInterpretedSourceResponseState(
        input.sourceResponse,
        input.sourceResponseFormat,
      )

    if (input.sourceResponseFormat === 'pending_answer_sources') {
      const entries = dependencies.parseRequiredPendingAnswerSourceEntries(
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
        decisionAnswers:
          dependencies.materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
            groupedEntries
              .filter((entry) => entry.route === 'decision')
              .map((entry) => entry.entry),
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

    const entries = dependencies.parseRequiredMatchingAnswerSourceEntries(
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
      decisionAnswers: dependencies.materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
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
    dependencies.registerMatchingRunCandidateGroups(sourceResponseState, [candidates])
    const groupKey = dependencies.resolveMatchingRunCandidateGroupKey(candidates)
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

  return {
    consumeSinglePendingSourceResponse,
    materializeMixedRemainingAnswerSourceInference,
    materializeRemainingPlanningAnswerFromAnswerSourceEntry,
    resolveInlineTopicSourceResponseSection,
    resolveLabeledSourceResponseSection,
    resolveMatchingAnswerSourceEntries,
    resolveMatchingAnswerSourceValue,
    resolveMatchingClosingRunSourceResponseValue,
    resolveMatchingMiddleRunSourceResponseValue,
    resolveMatchingOpeningRunSourceResponseValue,
    resolveMatchingRunSourceResponseValue,
    resolvePendingAnswerSourceValue,
    resolvePendingSourceResponseClause,
    resolvePendingSourceResponseConjunction,
    resolvePendingSourceResponseParagraph,
    resolvePendingSourceResponseSentence,
  }
}
