import { AnswerInterpretationError } from './answerInterpretationErrors'
import {
  dedupeNonEmptyStrings,
  normalizeSourceResponseText,
} from './answerInterpretationStrings'
import type {
  CanonicalQuestionAnchorMatch,
  EmbeddedMatchingRunAnchor,
  EmbeddedMatchingRunToken,
  EmbeddedTopicAnchor,
} from './answerInterpretationTypes'

interface EmbeddedAnchorSupportDependencies {
  normalizeEmbeddedQuestionAnchorText: (question: string) => string
  normalizeQuestionPromptCore: (value: string) => string
  stripLeadingPresentationListMarkers: (text: string) => string
  stripStandalonePresentationListMarkerTokens: (text: string) => string
  stripTrailingPresentationListMarkers: (text: string) => string
}

const EMBEDDED_MATCHING_RUN_APOSTROPHE_T_CONTRACTIONS = new Map([
  ['aren', "aren't"],
  ['can', "can't"],
  ['couldn', "couldn't"],
  ['didn', "didn't"],
  ['don', "don't"],
  ['doesn', "doesn't"],
  ['hadn', "hadn't"],
  ['haven', "haven't"],
  ['hasn', "hasn't"],
  ['isn', "isn't"],
  ['mayn', "mayn't"],
  ['mightn', "mightn't"],
  ['mustn', "mustn't"],
  ['needn', "needn't"],
  ['oughtn', "oughtn't"],
  ['shan', "shan't"],
  ['shouldn', "shouldn't"],
  ['wasn', "wasn't"],
  ['weren', "weren't"],
  ['won', "won't"],
  ['wouldn', "wouldn't"],
])

const EMBEDDED_MATCHING_RUN_APOSTROPHE_EXISTENTIAL_STARTER_CONTRACTIONS = new Map([
  ['d', "there'd"],
  ['ll', "there'll"],
  ['ve', "there've"],
])

const EMBEDDED_MATCHING_RUN_APOSTROPHE_EXISTENTIAL_COPULA_CONTRACTIONS = new Map([
  ['re', "there're"],
  ['s', "there's"],
])

const EMBEDDED_CANONICAL_QUESTION_SUBJECT_LEADING_TOKENS = new Set([
  'a',
  'an',
  'her',
  'his',
  'its',
  'my',
  'our',
  'that',
  'the',
  'their',
  'these',
  'this',
  'those',
  'your',
])

const EMBEDDED_CANONICAL_QUESTION_SUBJECT_REJECT_TOKENS = new Set([
  'a',
  'all',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'could',
  'do',
  'does',
  'for',
  'had',
  'has',
  'have',
  'her',
  'his',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'my',
  'of',
  'on',
  'or',
  'our',
  'should',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'these',
  'this',
  'those',
  'through',
  'to',
  'via',
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
  'with',
  'would',
  'your',
])

export function createAnswerInterpretationEmbeddedAnchorSupport(
  dependencies: EmbeddedAnchorSupportDependencies,
) {
  function normalizeEmbeddedMatchingRunText(text: string) {
    return dependencies.stripStandalonePresentationListMarkerTokens(
      dependencies.stripTrailingPresentationListMarkers(
        dependencies.stripLeadingPresentationListMarkers(text.trim()),
      ),
    )
  }

  function tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse: string) {
    const tokens: EmbeddedMatchingRunToken[] = []
    const pattern = /[a-z0-9]+/gi
    while (true) {
      const match = pattern.exec(sourceResponse)
      if (match === null) {
        break
      }

      const normalizedText = match[0].toLowerCase()
      const previousToken = tokens[tokens.length - 1]
      const separator = previousToken ? sourceResponse.slice(previousToken.end, match.index) : ''
      const mergedContractedNegative =
        normalizedText === 't' && /['’]/u.test(separator)
          ? EMBEDDED_MATCHING_RUN_APOSTROPHE_T_CONTRACTIONS.get(
              previousToken?.normalizedText ?? '',
            )
          : undefined
      const mergedExistentialStarter =
        previousToken?.normalizedText === 'there' && /['’]/u.test(separator)
          ? EMBEDDED_MATCHING_RUN_APOSTROPHE_EXISTENTIAL_STARTER_CONTRACTIONS.get(normalizedText)
          : undefined
      const mergedExistentialCopula =
        previousToken?.normalizedText === 'there' && /['’]/u.test(separator)
          ? EMBEDDED_MATCHING_RUN_APOSTROPHE_EXISTENTIAL_COPULA_CONTRACTIONS.get(normalizedText)
          : undefined

      if (previousToken && mergedContractedNegative) {
        previousToken.normalizedText = mergedContractedNegative
        previousToken.end = match.index + match[0].length
        continue
      }

      if (previousToken && mergedExistentialStarter) {
        previousToken.normalizedText = mergedExistentialStarter
        previousToken.end = match.index + match[0].length
        continue
      }

      if (previousToken && mergedExistentialCopula) {
        previousToken.normalizedText = mergedExistentialCopula
        previousToken.end = match.index + match[0].length
        continue
      }

      tokens.push({
        normalizedText,
        start: match.index,
        end: match.index + match[0].length,
      })
    }

    return tokens
  }

  function resolveCanonicalQuestionAnchorMatch(
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    startTokenIndex: number,
  ): CanonicalQuestionAnchorMatch | undefined {
    if (
      tokens[startTokenIndex]?.normalizedText !== 'what' ||
      tokens[startTokenIndex + 1]?.normalizedText !== 'should'
    ) {
      return undefined
    }

    const maxEndTokenIndex = Math.min(tokens.length, startTokenIndex + 10)
    for (
      let endTokenIndex = startTokenIndex + 3;
      endTokenIndex < maxEndTokenIndex;
      endTokenIndex += 1
    ) {
      if (tokens[endTokenIndex]?.normalizedText !== 'be') {
        continue
      }

      const subjectLeadingToken = tokens[startTokenIndex + 2]?.normalizedText
      const subjectStartTokenIndex = EMBEDDED_CANONICAL_QUESTION_SUBJECT_LEADING_TOKENS.has(
        subjectLeadingToken ?? '',
      )
        ? startTokenIndex + 3
        : startTokenIndex + 2
      if (subjectStartTokenIndex >= endTokenIndex) {
        continue
      }

      const subjectTokens = tokens
        .slice(subjectStartTokenIndex, endTokenIndex)
        .map((token) => token.normalizedText)
      if (
        subjectTokens.length === 0 ||
        subjectTokens.some((token) =>
          EMBEDDED_CANONICAL_QUESTION_SUBJECT_REJECT_TOKENS.has(token),
        )
      ) {
        continue
      }

      const endOriginal = tokens[endTokenIndex]?.end ?? sourceResponse.length
      const rawQuestion = sourceResponse
        .slice(tokens[startTokenIndex]?.start ?? 0, endOriginal)
        .trim()
      const canonicalPrompt = dependencies.normalizeEmbeddedQuestionAnchorText(rawQuestion)
      if (canonicalPrompt === rawQuestion) {
        continue
      }

      return {
        rawQuestion,
        canonicalPrompt,
        endTokenIndex,
        endOriginal,
      }
    }

    return undefined
  }

  function resolveEmbeddedMatchingRunAnchors(
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    candidateGroups: string[][],
    sourceResponseFormat: 'matching_opening_runs' | 'matching_closing_runs' | 'matching_middle_runs',
  ) {
    const anchors: EmbeddedMatchingRunAnchor[] = []

    candidateGroups.forEach((candidateGroup, candidateGroupIndex) => {
      const matches = collapseEmbeddedMatchingRunRanges(
        findEmbeddedMatchingRunTokenRanges(tokens, candidateGroup),
      )
      if (matches.length > 1) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat ${sourceResponseFormat} found multiple embedded anchors for the same matched consumer.`,
        )
      }
      const match = matches[0]
      if (!match) {
        return
      }
      anchors.push({
        candidateGroupIndex,
        startTokenIndex: match.startTokenIndex,
        endTokenIndex: match.endTokenIndex,
        startOriginal: tokens[match.startTokenIndex]?.start ?? 0,
        endOriginal: tokens[match.endTokenIndex - 1]?.end ?? sourceResponse.length,
      })
    })

    anchors.sort((left, right) => left.startTokenIndex - right.startTokenIndex)
    for (let index = 1; index < anchors.length; index += 1) {
      const previous = anchors[index - 1] as EmbeddedMatchingRunAnchor
      const current = anchors[index] as EmbeddedMatchingRunAnchor
      if (current.startTokenIndex < previous.endTokenIndex) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat ${sourceResponseFormat} found overlapping embedded anchors for different matched consumers.`,
        )
      }
    }

    return anchors
  }

  function resolveEmbeddedQuestionAnchors(
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    candidateGroups: string[][],
    sourceResponseFormat: 'question_spans' | 'question_middle_spans' | 'question_closing_spans',
  ) {
    const anchors: EmbeddedMatchingRunAnchor[] = []

    candidateGroups.forEach((candidateGroup, candidateGroupIndex) => {
      const matches = collapseEmbeddedMatchingRunRanges(
        findEmbeddedMatchingRunTokenRanges(tokens, candidateGroup),
      )
      if (matches.length > 1) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat ${sourceResponseFormat} found multiple embedded anchors for the same matched question.`,
        )
      }
      const match = matches[0]
      if (!match) {
        return
      }
      anchors.push({
        candidateGroupIndex,
        startTokenIndex: match.startTokenIndex,
        endTokenIndex: match.endTokenIndex,
        startOriginal: tokens[match.startTokenIndex]?.start ?? 0,
        endOriginal: tokens[match.endTokenIndex - 1]?.end ?? sourceResponse.length,
      })
    })

    anchors.sort((left, right) => left.startTokenIndex - right.startTokenIndex)
    for (let index = 1; index < anchors.length; index += 1) {
      const previous = anchors[index - 1] as EmbeddedMatchingRunAnchor
      const current = anchors[index] as EmbeddedMatchingRunAnchor
      if (current.startTokenIndex < previous.endTokenIndex) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat ${sourceResponseFormat} found overlapping embedded anchors for different matched questions.`,
        )
      }
    }

    return anchors
  }

  function resolveEmbeddedQuestionAnchorsWithInferredCandidates(
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    candidateGroups: string[][],
    sourceResponseFormat: 'question_spans' | 'question_middle_spans' | 'question_closing_spans',
  ) {
    const explicitCandidateGroups = filterEmbeddedQuestionCandidateGroups(candidateGroups)
    const explicitAnchors = explicitCandidateGroups.length
      ? resolveEmbeddedQuestionAnchors(
          sourceResponse,
          tokens,
          explicitCandidateGroups,
          sourceResponseFormat,
        )
      : []
    const inferredCandidateGroups = inferEmbeddedCanonicalQuestionCandidateGroups(
      sourceResponse,
      tokens,
    )
    const inferredAnchors = inferredCandidateGroups.length
      ? resolveEmbeddedQuestionAnchors(
          sourceResponse,
          tokens,
          inferredCandidateGroups,
          sourceResponseFormat,
        )
      : []

    if (explicitAnchors.length === 0) {
      return inferredAnchors
    }
    if (inferredAnchors.length === 0) {
      return explicitAnchors
    }

    const merged = [...explicitAnchors]
    for (const inferredAnchor of inferredAnchors) {
      const duplicate = merged.some(
        (anchor) =>
          anchor.startTokenIndex === inferredAnchor.startTokenIndex &&
          anchor.endTokenIndex === inferredAnchor.endTokenIndex,
      )
      if (!duplicate) {
        merged.push(inferredAnchor)
      }
    }

    merged.sort((left, right) => left.startTokenIndex - right.startTokenIndex)
    for (let index = 1; index < merged.length; index += 1) {
      const previous = merged[index - 1] as EmbeddedMatchingRunAnchor
      const current = merged[index] as EmbeddedMatchingRunAnchor
      if (current.startTokenIndex < previous.endTokenIndex) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat ${sourceResponseFormat} found overlapping embedded anchors for different matched questions.`,
        )
      }
    }

    return merged
  }

  function resolveEmbeddedTopicAnchors(
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    candidateLabels: string[],
    sourceResponseFormat: 'topic_spans' | 'topic_middle_spans' | 'topic_closing_spans',
  ) {
    const anchors: EmbeddedTopicAnchor[] = []

    for (const candidateLabel of candidateLabels) {
      const normalizedLabel = normalizeSourceResponseText(candidateLabel)
      if (!normalizedLabel) {
        continue
      }

      const matches = collapseEmbeddedMatchingRunRanges(
        findEmbeddedMatchingRunTokenRanges(tokens, [candidateLabel]),
      )
      if (matches.length > 1) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat ${sourceResponseFormat} found multiple embedded anchors for the same topic label.`,
        )
      }

      const match = matches[0]
      if (!match) {
        continue
      }

      anchors.push({
        normalizedLabel,
        startTokenIndex: match.startTokenIndex,
        endTokenIndex: match.endTokenIndex,
        startOriginal: tokens[match.startTokenIndex]?.start ?? 0,
        endOriginal: tokens[match.endTokenIndex - 1]?.end ?? sourceResponse.length,
      })
    }

    anchors.sort((left, right) => left.startTokenIndex - right.startTokenIndex)
    const filteredAnchors: EmbeddedTopicAnchor[] = []
    for (const anchor of anchors) {
      const previous = filteredAnchors[filteredAnchors.length - 1]
      if (!previous || anchor.startTokenIndex >= previous.endTokenIndex) {
        filteredAnchors.push(anchor)
        continue
      }

      const previousContainsCurrent = normalizedTopicLabelContainsLabel(
        previous.normalizedLabel,
        anchor.normalizedLabel,
      )
      const currentContainsPrevious = normalizedTopicLabelContainsLabel(
        anchor.normalizedLabel,
        previous.normalizedLabel,
      )
      if (previousContainsCurrent && !currentContainsPrevious) {
        filteredAnchors[filteredAnchors.length - 1] = anchor
        continue
      }
      if (currentContainsPrevious && !previousContainsCurrent) {
        continue
      }

      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} found overlapping embedded topic anchors for different topic labels.`,
      )
    }

    return filteredAnchors
  }

  function collapseEmbeddedMatchingRunRanges(
    ranges: Array<{ startTokenIndex: number; endTokenIndex: number }>,
  ) {
    if (ranges.length <= 1) {
      return ranges
    }

    const sorted = [...ranges].sort((left, right) => left.startTokenIndex - right.startTokenIndex)
    const collapsed: Array<{ startTokenIndex: number; endTokenIndex: number }> = []

    for (const range of sorted) {
      const previous = collapsed[collapsed.length - 1]
      if (!previous || range.startTokenIndex >= previous.endTokenIndex) {
        collapsed.push({ ...range })
        continue
      }
      previous.startTokenIndex = Math.min(previous.startTokenIndex, range.startTokenIndex)
      previous.endTokenIndex = Math.max(previous.endTokenIndex, range.endTokenIndex)
    }

    return collapsed
  }

  function findEmbeddedMatchingRunTokenRanges(
    tokens: EmbeddedMatchingRunToken[],
    candidateGroup: string[],
  ) {
    const ranges = new Map<string, { startTokenIndex: number; endTokenIndex: number }>()

    for (const candidate of candidateGroup) {
      const normalizedCandidate = normalizeSourceResponseText(candidate)
      const normalizedCandidateCore = dependencies.normalizeQuestionPromptCore(candidate)
      const sequences = dedupeNonEmptyStrings([normalizedCandidate, normalizedCandidateCore])
      for (const sequence of sequences) {
        const candidateTokens = sequence.split(' ').filter(Boolean)
        if (candidateTokens.length === 0) {
          continue
        }
        for (
          let startTokenIndex = 0;
          startTokenIndex <= tokens.length - candidateTokens.length;
          startTokenIndex += 1
        ) {
          const matches = candidateTokens.every(
            (token, offset) => tokens[startTokenIndex + offset]?.normalizedText === token,
          )
          if (!matches) {
            continue
          }
          const endTokenIndex = startTokenIndex + candidateTokens.length
          ranges.set(`${startTokenIndex}:${endTokenIndex}`, {
            startTokenIndex,
            endTokenIndex,
          })
        }
      }
    }

    return [...ranges.values()].sort((left, right) => left.startTokenIndex - right.startTokenIndex)
  }

  function filterEmbeddedQuestionCandidateGroups(candidateGroups: string[][]) {
    return candidateGroups.flatMap((candidateGroup) => {
      const filteredGroup = dedupeNonEmptyStrings(candidateGroup.filter(isEmbeddedQuestionCandidate))
      return filteredGroup.length > 0 ? [filteredGroup] : []
    })
  }

  function isEmbeddedQuestionCandidate(candidate: string) {
    const trimmed = candidate.trim()
    if (!trimmed) {
      return false
    }
    if (/[?？]/u.test(trimmed)) {
      return true
    }

    const normalized = normalizeSourceResponseText(trimmed)
    return /^(?:what|which|who|whom|whose|why|where|when|how)\b/.test(normalized)
  }

  function inferEmbeddedCanonicalQuestionCandidateGroups(
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
  ) {
    const groups: string[][] = []

    for (let startTokenIndex = 0; startTokenIndex < tokens.length - 3; startTokenIndex += 1) {
      const match = resolveCanonicalQuestionAnchorMatch(sourceResponse, tokens, startTokenIndex)
      if (!match) {
        continue
      }

      groups.push(dedupeNonEmptyStrings([match.rawQuestion, match.canonicalPrompt]))
    }

    return groups
  }

  function normalizedTopicLabelContainsLabel(
    normalizedCandidateLabel: string,
    normalizedContainedLabel: string,
  ) {
    return ` ${normalizedCandidateLabel} `.includes(` ${normalizedContainedLabel} `)
  }

  return {
    normalizeEmbeddedMatchingRunText,
    resolveCanonicalQuestionAnchorMatch,
    resolveEmbeddedMatchingRunAnchors,
    resolveEmbeddedQuestionAnchorsWithInferredCandidates,
    resolveEmbeddedTopicAnchors,
    tokenizeEmbeddedMatchingRunSourceResponse,
  }
}
