import { synthesizeCanonicalPromptFromSummary } from '../domain/canonicalPrompt'
import type { AnswerCaptureFormat } from '../domain/answerCaptureFormat'
import type { ResolvedAnswerSourceEntry } from './answerInterpretationAnswerSourceSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import {
  createKnownDecisionsByDecisionKeyLookup,
  createKnownDecisionsBySummaryLookup,
  normalizeSourceResponseLabel,
} from './answerInterpretationStrings'

interface RemainingDecisionAnswerSourceKnownDecision {
  decisionKey: string
  summary: string
  summaryKey?: string
  taskRef?: string
}

interface RemainingDecisionAnswerSourceMaterializedAnswer {
  summary: string
  summaryKey?: string
  prompt?: string
  matchHints?: string[]
  decisionKey?: string
  taskRef?: string
  answer: string
}

interface RemainingDecisionAnswerSourceSupportDependencies {
  hasMultipleStableMatchHints: (matchHints: string[] | undefined) => boolean
  inferSummaryFromDecisionKey: (decisionKey: string | undefined) => string | undefined
  inferSummaryFromStableAnswerSourceKey: (key: string | undefined) => string | undefined
  inferSummaryFromStableMatchHints: (matchHints: string[] | undefined) => string | undefined
  inferSummaryFromStablePrompt: (prompt: string | undefined) => string | undefined
  inferSummaryFromStableSummaryKey: (summaryKey: string | undefined) => string | undefined
  inferSummaryKeyFromStableAnswerSourceKey: (key: string | undefined) => string | undefined
  shouldDeriveSummaryKeyFromAnswerSourceKey: (entry: ResolvedAnswerSourceEntry) => boolean
}

export function createAnswerInterpretationRemainingDecisionAnswerSourceSupport(
  dependencies: RemainingDecisionAnswerSourceSupportDependencies,
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

  function finalizeMaterializedDecisionAnswers(
    answers: RemainingDecisionAnswerSourceMaterializedAnswer[],
    captureFormat: AnswerCaptureFormat | undefined,
  ) {
    if (!captureFormat) {
      return answers
    }

    return answers.map((answer) => attachCaptureFormat(answer, captureFormat))
  }

  function inferSummaryFromStableAnswerSourceEntryKey(entry: ResolvedAnswerSourceEntry) {
    if (entry.sourceKeys.length !== 1) {
      return undefined
    }
    return dependencies.inferSummaryFromStableAnswerSourceKey(entry.sourceKeys[0])
  }

  function resolveRequiredAnswerSourceSummary(entry: ResolvedAnswerSourceEntry, label: string) {
    const summary = entry.summary?.trim()
    if (summary) {
      return summary
    }

    const summaryFromPrompt = dependencies.inferSummaryFromStablePrompt(entry.prompt)
    if (summaryFromPrompt) {
      return summaryFromPrompt
    }

    const summaryFromDecisionKey = dependencies.inferSummaryFromDecisionKey(entry.decisionKey)
    if (summaryFromDecisionKey) {
      return summaryFromDecisionKey
    }

    const summaryFromSummaryKey = dependencies.inferSummaryFromStableSummaryKey(entry.summaryKey)
    if (summaryFromSummaryKey) {
      return summaryFromSummaryKey
    }

    const summaryFromMatchHint = dependencies.inferSummaryFromStableMatchHints(entry.matchHints)
    if (summaryFromMatchHint) {
      return summaryFromMatchHint
    }

    if (dependencies.hasMultipleStableMatchHints(entry.matchHints)) {
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

  function materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries(
    entries: ResolvedAnswerSourceEntry[],
    knownDecisions: RemainingDecisionAnswerSourceKnownDecision[],
    label: string,
    captureFormat?: AnswerCaptureFormat,
  ) {
    const knownDecisionsBySummary = createKnownDecisionsBySummaryLookup(knownDecisions)
    const knownDecisionsByDecisionKey = createKnownDecisionsByDecisionKeyLookup(knownDecisions)
    const answers: RemainingDecisionAnswerSourceMaterializedAnswer[] = entries.map((entry) => {
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
      const inferredSummaryKey = dependencies.shouldDeriveSummaryKeyFromAnswerSourceKey(entry)
        ? dependencies.inferSummaryKeyFromStableAnswerSourceKey(entry.key)
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

  return {
    inferSummaryFromStableAnswerSourceEntryKey,
    materializeRemainingDecisionTopicAnswersFromAnswerSourceEntries,
    resolveRequiredAnswerSourceSummary,
  }
}
