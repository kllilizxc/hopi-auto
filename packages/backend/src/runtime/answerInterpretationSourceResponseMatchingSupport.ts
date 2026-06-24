import { buildMatchingRunCandidateGroupKey, dedupeNonEmptyStrings, normalizeSourceResponseText } from './answerInterpretationStrings'
import type {
  InterpretedSourceResponseState,
  QuestionSourceResponseBlock,
  QuestionSourceResponseClosingBlock,
  QuestionSourceResponseClosingSpan,
  QuestionSourceResponseSpan,
  TopicSourceResponseBlock,
  TopicSourceResponseClosingBlock,
  TopicSourceResponseClosingSpan,
  TopicSourceResponseParagraph,
  TopicSourceResponseSentence,
  TopicSourceResponseSpan,
} from './answerInterpretationTypes'

interface SourceResponseMatchingSupportDependencies {
  normalizeQuestionPromptCore: (value: string) => string
  questionTextMatchesCandidate: (
    normalizedQuestionText: string,
    normalizedQuestionCoreText: string,
    normalizedCandidate: string,
    normalizedCandidateCore: string,
  ) => boolean
  topicTextMatchesCandidate: (
    normalizedTopicText: string,
    normalizedCandidate: string,
    normalizedCandidateCore: string,
  ) => boolean
}

export function createAnswerInterpretationSourceResponseMatchingSupport(
  dependencies: SourceResponseMatchingSupportDependencies,
) {
  function findMatchingTopicTextUnitIndexes(
    units: Array<{ normalizedText: string }>,
    candidates: string[],
    consumedIndexes: Set<number> = new Set<number>(),
  ) {
    const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
      normalizedCandidate: normalizeSourceResponseText(candidate),
      normalizedCandidateCore: dependencies.normalizeQuestionPromptCore(candidate),
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
          dependencies.topicTextMatchesCandidate(
            unit.normalizedText,
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

  function findMatchingTopicClauseIndexes(
    clauses: TopicSourceResponseSentence[],
    candidates: string[],
    consumedIndexes: Set<number> = new Set<number>(),
  ) {
    return findMatchingTopicTextUnitIndexes(clauses, candidates, consumedIndexes)
  }

  function findMatchingTopicSentenceIndexes(
    sentences: TopicSourceResponseSentence[],
    candidates: string[],
    consumedIndexes: Set<number> = new Set<number>(),
  ) {
    return findMatchingTopicTextUnitIndexes(sentences, candidates, consumedIndexes)
  }

  function findMatchingQuestionBlockIndexes(
    blocks: QuestionSourceResponseBlock[],
    candidates: string[],
    consumedIndexes: Set<number> = new Set<number>(),
  ) {
    const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
      normalizedCandidate: normalizeSourceResponseText(candidate),
      normalizedCandidateCore: dependencies.normalizeQuestionPromptCore(candidate),
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
          dependencies.questionTextMatchesCandidate(
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
    consumedIndexes: Set<number> = new Set<number>(),
  ) {
    const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
      normalizedCandidate: normalizeSourceResponseText(candidate),
      normalizedCandidateCore: dependencies.normalizeQuestionPromptCore(candidate),
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
          dependencies.questionTextMatchesCandidate(
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
    consumedIndexes: Set<number> = new Set<number>(),
  ) {
    const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
      normalizedCandidate: normalizeSourceResponseText(candidate),
      normalizedCandidateCore: dependencies.normalizeQuestionPromptCore(candidate),
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
          dependencies.questionTextMatchesCandidate(
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
    consumedIndexes: Set<number> = new Set<number>(),
  ) {
    const normalizedCandidates = dedupeNonEmptyStrings(candidates).map((candidate) => ({
      normalizedCandidate: normalizeSourceResponseText(candidate),
      normalizedCandidateCore: dependencies.normalizeQuestionPromptCore(candidate),
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
          dependencies.questionTextMatchesCandidate(
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
    consumedIndexes: Set<number> = new Set<number>(),
  ) {
    return findMatchingTopicTextUnitIndexes(paragraphs, candidates, consumedIndexes)
  }

  function findMatchingTopicSpanIndexes(
    spans: TopicSourceResponseSpan[],
    candidates: string[],
    consumedIndexes: Set<number> = new Set<number>(),
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
    consumedIndexes: Set<number> = new Set<number>(),
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
    consumedIndexes: Set<number> = new Set<number>(),
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
    consumedIndexes: Set<number> = new Set<number>(),
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
        dependencies.topicTextMatchesCandidate(
          normalizedText,
          normalizedCandidate,
          dependencies.normalizeQuestionPromptCore(normalizedCandidate),
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
      (sourceResponseState.sourceResponseFormat !== 'topic_clauses' &&
        sourceResponseState.sourceResponseFormat !== 'topic_spans' &&
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
      sourceResponseState.topicClauses = undefined
      sourceResponseState.topicSpans = undefined
      sourceResponseState.topicMiddleSpans = undefined
      sourceResponseState.topicClosingSpans = undefined
      sourceResponseState.topicClosingBlocks = undefined
      sourceResponseState.topicMiddleBlocks = undefined
      sourceResponseState.topicBlocks = undefined
    }
  }

  function registerQuestionAnchorCandidateGroups(
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) {
    if (
      !sourceResponseState ||
      (sourceResponseState.sourceResponseFormat !== 'question_spans' &&
        sourceResponseState.sourceResponseFormat !== 'question_middle_spans' &&
        sourceResponseState.sourceResponseFormat !== 'question_closing_spans')
    ) {
      return
    }

    const groups = sourceResponseState.questionAnchorCandidateGroups ?? []
    const lookup = sourceResponseState.questionAnchorCandidateLookup ?? new Map<string, number>()
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

    sourceResponseState.questionAnchorCandidateGroups = groups
    sourceResponseState.questionAnchorCandidateLookup = lookup
    if (changed) {
      sourceResponseState.questionSpans = undefined
      sourceResponseState.questionMiddleSpans = undefined
      sourceResponseState.questionClosingSpans = undefined
    }
  }

  function registerMatchingRunCandidateGroups(
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) {
    if (
      !sourceResponseState ||
      (sourceResponseState.sourceResponseFormat !== 'matching_runs' &&
        sourceResponseState.sourceResponseFormat !== 'matching_opening_runs' &&
        sourceResponseState.sourceResponseFormat !== 'matching_closing_runs' &&
        sourceResponseState.sourceResponseFormat !== 'matching_middle_runs')
    ) {
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
      sourceResponseState.matchingOpeningRuns = undefined
      sourceResponseState.matchingClosingRuns = undefined
      sourceResponseState.matchingMiddleRuns = undefined
    }
  }

  return {
    findMatchingNormalizedTopicLabels,
    findMatchingQuestionBlockIndexes,
    findMatchingQuestionClosingBlockIndexes,
    findMatchingQuestionClosingSpanIndexes,
    findMatchingQuestionSpanIndexes,
    findMatchingTopicBlockIndexes,
    findMatchingTopicClauseIndexes,
    findMatchingTopicClosingBlockIndexes,
    findMatchingTopicClosingSpanIndexes,
    findMatchingTopicParagraphIndexes,
    findMatchingTopicSentenceIndexes,
    findMatchingTopicSpanIndexes,
    findMatchingTopicTextUnitIndexes,
    registerMatchingRunCandidateGroups,
    registerQuestionAnchorCandidateGroups,
    registerTopicAnchorCandidates,
  }
}
