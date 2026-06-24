import { AnswerInterpretationError } from './answerInterpretationErrors'
import { normalizeSourceResponseText } from './answerInterpretationStrings'
import type {
  EmbeddedMatchingRunAnchor,
  EmbeddedMatchingRunToken,
  InterpretedSourceResponseState,
  MatchingSourceResponseRun,
} from './answerInterpretationTypes'

type SourceResponseUnit = {
  text: string
  normalizedText: string
}

interface MatchingRunSupportDependencies {
  findMatchingTopicTextUnitIndexes: (
    units: Array<{ normalizedText: string }>,
    candidates: string[],
    consumedIndexes: Set<number>,
  ) => number[]
  normalizeEmbeddedMatchingRunText: (text: string) => string
  normalizeGenericPendingOrMatchingUnitText: (text: string) => string
  parseTopicSourceResponseClauses: (sourceResponse: string) => SourceResponseUnit[]
  parseTopicSourceResponseParagraphs: (sourceResponse: string) => SourceResponseUnit[]
  parseTopicSourceResponseSentences: (sourceResponse: string) => SourceResponseUnit[]
  resolveEmbeddedMatchingRunAnchors: (
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    candidateGroups: string[][],
    sourceResponseFormat: 'matching_opening_runs' | 'matching_closing_runs' | 'matching_middle_runs',
  ) => EmbeddedMatchingRunAnchor[]
  tokenizeEmbeddedMatchingRunSourceResponse: (sourceResponse: string) => EmbeddedMatchingRunToken[]
}

export function createAnswerInterpretationMatchingRunSupport(
  dependencies: MatchingRunSupportDependencies,
) {
  function parseGenericMatchingSourceResponseParagraphUnits(sourceResponse: string) {
    return dependencies
      .parseTopicSourceResponseParagraphs(sourceResponse)
      .map((paragraph) => dependencies.normalizeGenericPendingOrMatchingUnitText(paragraph.text))
      .filter(Boolean)
      .map((text) => ({
        text,
        normalizedText: normalizeSourceResponseText(text),
      }))
  }

  function parseGenericMatchingSourceResponseSentenceUnits(sourceResponse: string) {
    return dependencies
      .parseTopicSourceResponseSentences(sourceResponse)
      .map((sentence) => dependencies.normalizeGenericPendingOrMatchingUnitText(sentence.text))
      .filter(Boolean)
      .map((text) => ({
        text,
        normalizedText: normalizeSourceResponseText(text),
      }))
  }

  function parseGenericMatchingSourceResponseClauseUnits(sourceResponse: string) {
    return dependencies
      .parseTopicSourceResponseClauses(sourceResponse)
      .map((clause) => dependencies.normalizeGenericPendingOrMatchingUnitText(clause.text))
      .filter(Boolean)
      .map((text) => ({
        text,
        normalizedText: normalizeSourceResponseText(text),
      }))
  }

  function parseMatchingSourceResponseRuns(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const cachedRuns = sourceResponseState?.matchingRuns
    if (cachedRuns) {
      return cachedRuns
    }

    const candidateGroups = sourceResponseState?.matchingRunCandidateGroups ?? []
    if (candidateGroups.length === 0) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_runs requires registered candidate groups for ${label}.`,
      )
    }

    const { units, joiner } = parseMatchingRunSourceResponseUnits(sourceResponse, label)
    const runs: MatchingSourceResponseRun[] = []
    let leadingTexts: string[] = []
    let pendingGapTexts: string[] = []
    let currentRun: MatchingSourceResponseRun | undefined

    for (const unit of units) {
      const matchingGroupIndexes = findMatchingRunGroupIndexes(unit, candidateGroups)
      if (matchingGroupIndexes.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple matching runs matched unit "${unit.text}" in sourceResponse.`,
        )
      }

      const matchingGroupIndex = matchingGroupIndexes[0]
      if (matchingGroupIndex === undefined) {
        if (currentRun) {
          pendingGapTexts.push(unit.text)
        } else {
          leadingTexts.push(unit.text)
        }
        continue
      }

      if (!currentRun) {
        if (leadingTexts.length > 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat matching_runs found unmatched prose before the first matched run.',
          )
        }
        currentRun = {
          text: unit.text,
          candidateGroupIndex: matchingGroupIndex,
        }
        leadingTexts = []
        continue
      }

      if (currentRun.candidateGroupIndex === matchingGroupIndex) {
        currentRun.text =
          pendingGapTexts.length > 0
            ? `${currentRun.text}${joiner}${pendingGapTexts.join(joiner)}${joiner}${unit.text}`
            : `${currentRun.text}${joiner}${unit.text}`
        pendingGapTexts = []
        continue
      }

      if (pendingGapTexts.length > 0) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_runs found unmatched prose between different matched consumers.',
        )
      }

      runs.push(currentRun)
      currentRun = {
        text: unit.text,
        candidateGroupIndex: matchingGroupIndex,
      }
    }

    if (!currentRun) {
      throw new AnswerInterpretationError(
        `No matching run matched any candidate group for ${label} in sourceResponse.`,
      )
    }

    if (pendingGapTexts.length > 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_runs found unmatched prose after the last matched run.',
      )
    }

    runs.push(currentRun)
    if (sourceResponseState) {
      sourceResponseState.matchingRuns = runs
    }
    return runs
  }

  function parseMatchingOpeningSourceResponseRuns(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const cachedRuns = sourceResponseState?.matchingOpeningRuns
    if (cachedRuns) {
      return cachedRuns
    }

    const candidateGroups = sourceResponseState?.matchingRunCandidateGroups ?? []
    if (candidateGroups.length === 0) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_opening_runs requires registered candidate groups for ${label}.`,
      )
    }

    const shared = sourceResponse?.trim()
    const sentenceCount = shared ? dependencies.parseTopicSourceResponseSentences(shared).length : 0
    const { units, joiner, unitLabel } = parseMatchingRunSourceResponseUnits(sourceResponse, label)
    if (sentenceCount === 1) {
      const embeddedRuns = parseEmbeddedMatchingOpeningSourceResponseRuns(
        sourceResponse,
        label,
        candidateGroups,
      )
      if (embeddedRuns) {
        if (sourceResponseState) {
          sourceResponseState.matchingOpeningRuns = embeddedRuns
        }
        return embeddedRuns
      }
    }

    const runs: MatchingSourceResponseRun[] = []
    const leadingTexts: string[] = []
    let currentMatchedTexts: string[] = []
    let currentCandidateGroupIndex: number | undefined
    let trailingTexts: string[] = []

    for (const unit of units) {
      const matchingGroupIndexes = findMatchingRunGroupIndexes(unit, candidateGroups)
      if (matchingGroupIndexes.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple matching opening runs matched unit "${unit.text}" in sourceResponse.`,
        )
      }

      const matchingGroupIndex = matchingGroupIndexes[0]
      if (matchingGroupIndex === undefined) {
        if (currentCandidateGroupIndex === undefined) {
          leadingTexts.push(unit.text)
        } else {
          trailingTexts.push(unit.text)
        }
        continue
      }

      if (currentCandidateGroupIndex === undefined) {
        if (leadingTexts.length > 0) {
          throw new AnswerInterpretationError(
            `sourceResponseFormat matching_opening_runs requires each run to start with a matched anchor before any leading ${unitLabel}.`,
          )
        }
        currentCandidateGroupIndex = matchingGroupIndex
        currentMatchedTexts = [unit.text]
        trailingTexts = []
        continue
      }

      if (trailingTexts.length === 0) {
        if (currentCandidateGroupIndex === matchingGroupIndex) {
          currentMatchedTexts.push(unit.text)
          continue
        }
        throw new AnswerInterpretationError(
          `sourceResponseFormat matching_opening_runs requires at least one trailing ${unitLabel} before the next matched anchor.`,
        )
      }

      if (currentCandidateGroupIndex === matchingGroupIndex) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat matching_opening_runs does not allow a matched anchor for the same consumer after trailing ${unitLabel} has started.`,
        )
      }

      runs.push({
        text: [...currentMatchedTexts, ...trailingTexts].join(joiner),
        candidateGroupIndex: currentCandidateGroupIndex,
      })
      currentCandidateGroupIndex = matchingGroupIndex
      currentMatchedTexts = [unit.text]
      trailingTexts = []
    }

    if (currentCandidateGroupIndex === undefined) {
      throw new AnswerInterpretationError(
        `No matching opening run matched any candidate group for ${label} in sourceResponse.`,
      )
    }

    if (trailingTexts.length === 0) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_opening_runs requires each run to end with at least one trailing ${unitLabel} after the matched anchor.`,
      )
    }

    runs.push({
      text: [...currentMatchedTexts, ...trailingTexts].join(joiner),
      candidateGroupIndex: currentCandidateGroupIndex,
    })

    if (sourceResponseState) {
      sourceResponseState.matchingOpeningRuns = runs
    }
    return runs
  }

  function parseEmbeddedMatchingOpeningSourceResponseRuns(
    sourceResponse: string | undefined,
    label: string,
    candidateGroups: string[][],
  ) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_opening_runs requires sourceResponse for ${label}.`,
      )
    }

    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(shared)
    if (tokens.length === 0) {
      return undefined
    }

    const anchors = dependencies.resolveEmbeddedMatchingRunAnchors(
      shared,
      tokens,
      candidateGroups,
      'matching_opening_runs',
    )
    if (anchors.length === 0) {
      return undefined
    }

    if (anchors[0]?.startTokenIndex !== 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_opening_runs requires each run to start with a matched anchor before any leading sentence.',
      )
    }

    const runs: MatchingSourceResponseRun[] = []
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] as EmbeddedMatchingRunAnchor
      const nextAnchor = anchors[index + 1]

      if (nextAnchor) {
        if (nextAnchor.startTokenIndex < anchor.endTokenIndex) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat matching_opening_runs found overlapping embedded anchors for different matched consumers.',
          )
        }
        if (nextAnchor.startTokenIndex === anchor.endTokenIndex) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat matching_opening_runs requires at least one trailing sentence before the next matched anchor.',
          )
        }
      } else if (anchor.endTokenIndex >= tokens.length) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_opening_runs requires each run to end with at least one trailing sentence after the matched anchor.',
        )
      }

      const endOriginal = nextAnchor?.startOriginal ?? shared.length
      runs.push({
        text: dependencies.normalizeEmbeddedMatchingRunText(
          shared.slice(anchor.startOriginal, endOriginal),
        ),
        candidateGroupIndex: anchor.candidateGroupIndex,
      })
    }

    return runs
  }

  function parseMatchingClosingSourceResponseRuns(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const cachedRuns = sourceResponseState?.matchingClosingRuns
    if (cachedRuns) {
      return cachedRuns
    }

    const candidateGroups = sourceResponseState?.matchingRunCandidateGroups ?? []
    if (candidateGroups.length === 0) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_closing_runs requires registered candidate groups for ${label}.`,
      )
    }

    const shared = sourceResponse?.trim()
    const sentenceCount = shared ? dependencies.parseTopicSourceResponseSentences(shared).length : 0
    const { units, joiner, unitLabel } = parseMatchingRunSourceResponseUnits(sourceResponse, label)
    if (sentenceCount === 1) {
      const embeddedRuns = parseEmbeddedMatchingClosingSourceResponseRuns(
        sourceResponse,
        label,
        candidateGroups,
      )
      if (embeddedRuns) {
        if (sourceResponseState) {
          sourceResponseState.matchingClosingRuns = embeddedRuns
        }
        return embeddedRuns
      }
    }

    const runs: MatchingSourceResponseRun[] = []
    let leadingTexts: string[] = []
    let currentMatchedTexts: string[] = []
    let currentCandidateGroupIndex: number | undefined

    for (const unit of units) {
      const matchingGroupIndexes = findMatchingRunGroupIndexes(unit, candidateGroups)
      if (matchingGroupIndexes.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple matching closing runs matched unit "${unit.text}" in sourceResponse.`,
        )
      }

      const matchingGroupIndex = matchingGroupIndexes[0]
      if (matchingGroupIndex === undefined) {
        if (currentCandidateGroupIndex === undefined) {
          leadingTexts.push(unit.text)
        } else {
          runs.push({
            text: [...leadingTexts, ...currentMatchedTexts].join(joiner),
            candidateGroupIndex: currentCandidateGroupIndex,
          })
          leadingTexts = [unit.text]
          currentMatchedTexts = []
          currentCandidateGroupIndex = undefined
        }
        continue
      }

      if (currentCandidateGroupIndex === undefined) {
        if (leadingTexts.length === 0) {
          throw new AnswerInterpretationError(
            `sourceResponseFormat matching_closing_runs requires each run to start with at least one leading ${unitLabel} before the matched anchor.`,
          )
        }
        currentCandidateGroupIndex = matchingGroupIndex
        currentMatchedTexts = [unit.text]
        continue
      }

      if (currentCandidateGroupIndex === matchingGroupIndex) {
        currentMatchedTexts.push(unit.text)
        continue
      }

      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_closing_runs requires at least one leading ${unitLabel} before the next matched anchor.`,
      )
    }

    if (currentCandidateGroupIndex === undefined) {
      if (runs.length === 0) {
        throw new AnswerInterpretationError(
          `No matching closing run matched any candidate group for ${label} in sourceResponse.`,
        )
      }
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_closing_runs requires each run to end with a matched anchor after at least one leading ${unitLabel}.`,
      )
    }

    runs.push({
      text: [...leadingTexts, ...currentMatchedTexts].join(joiner),
      candidateGroupIndex: currentCandidateGroupIndex,
    })

    if (sourceResponseState) {
      sourceResponseState.matchingClosingRuns = runs
    }
    return runs
  }

  function parseEmbeddedMatchingClosingSourceResponseRuns(
    sourceResponse: string | undefined,
    label: string,
    candidateGroups: string[][],
  ) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_closing_runs requires sourceResponse for ${label}.`,
      )
    }

    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(shared)
    if (tokens.length === 0) {
      return undefined
    }

    const anchors = dependencies.resolveEmbeddedMatchingRunAnchors(
      shared,
      tokens,
      candidateGroups,
      'matching_closing_runs',
    )
    if (anchors.length === 0) {
      return undefined
    }

    if (anchors[0]?.startTokenIndex === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_closing_runs requires each run to start with at least one leading sentence before the matched anchor.',
      )
    }

    const runs: MatchingSourceResponseRun[] = []
    let previousEndTokenIndex = 0
    let previousEndOriginal = 0

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] as EmbeddedMatchingRunAnchor
      const nextAnchor = anchors[index + 1]
      const nextTokenStartOriginal = tokens[anchor.endTokenIndex]?.start ?? shared.length

      if (anchor.startTokenIndex <= previousEndTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_closing_runs found overlapping embedded anchors for different matched consumers.',
        )
      }

      if (nextAnchor) {
        if (nextAnchor.startTokenIndex < anchor.endTokenIndex) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat matching_closing_runs found overlapping embedded anchors for different matched consumers.',
          )
        }
        if (nextAnchor.startTokenIndex === anchor.endTokenIndex) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat matching_closing_runs requires at least one leading sentence before the next matched anchor.',
          )
        }
      } else if (anchor.endTokenIndex < tokens.length) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_closing_runs requires each run to end with a matched anchor after at least one leading sentence.',
        )
      }

      runs.push({
        text: dependencies.normalizeEmbeddedMatchingRunText(
          shared.slice(previousEndOriginal, nextTokenStartOriginal),
        ),
        candidateGroupIndex: anchor.candidateGroupIndex,
      })
      previousEndTokenIndex = anchor.endTokenIndex
      previousEndOriginal = nextTokenStartOriginal
    }

    return runs
  }

  function parseMatchingMiddleSourceResponseRuns(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const cachedRuns = sourceResponseState?.matchingMiddleRuns
    if (cachedRuns) {
      return cachedRuns
    }

    const candidateGroups = sourceResponseState?.matchingRunCandidateGroups ?? []
    if (candidateGroups.length === 0) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_middle_runs requires registered candidate groups for ${label}.`,
      )
    }

    const shared = sourceResponse?.trim()
    const sentenceCount = shared ? dependencies.parseTopicSourceResponseSentences(shared).length : 0
    const { units, joiner, unitLabel } = parseMatchingRunSourceResponseUnits(sourceResponse, label)
    if (sentenceCount === 1) {
      const embeddedRuns = parseEmbeddedMatchingMiddleSourceResponseRuns(
        sourceResponse,
        label,
        candidateGroups,
      )
      if (embeddedRuns) {
        if (sourceResponseState) {
          sourceResponseState.matchingMiddleRuns = embeddedRuns
        }
        return embeddedRuns
      }
    }

    const runs: MatchingSourceResponseRun[] = []
    let currentLeadingTexts: string[] = []
    let currentAnchor: { text: string; candidateGroupIndex: number } | undefined
    let trailingTexts: string[] = []

    for (const unit of units) {
      const matchingGroupIndexes = findMatchingRunGroupIndexes(unit, candidateGroups)
      if (matchingGroupIndexes.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple matching middle runs matched unit "${unit.text}" in sourceResponse.`,
        )
      }

      const matchingGroupIndex = matchingGroupIndexes[0]
      if (matchingGroupIndex === undefined) {
        if (!currentAnchor) {
          currentLeadingTexts.push(unit.text)
        } else {
          trailingTexts.push(unit.text)
        }
        continue
      }

      if (!currentAnchor) {
        if (currentLeadingTexts.length === 0) {
          throw new AnswerInterpretationError(
            `sourceResponseFormat matching_middle_runs requires each run to start with at least one leading ${unitLabel} before the matched anchor.`,
          )
        }
        currentAnchor = {
          text: unit.text,
          candidateGroupIndex: matchingGroupIndex,
        }
        trailingTexts = []
        continue
      }

      if (trailingTexts.length < 2) {
        throw new AnswerInterpretationError(
          `sourceResponseFormat matching_middle_runs requires at least one trailing ${unitLabel} before the next matched anchor and at least one leading ${unitLabel} for that next run.`,
        )
      }

      runs.push({
        text: [...currentLeadingTexts, currentAnchor.text, ...trailingTexts.slice(0, -1)].join(
          joiner,
        ),
        candidateGroupIndex: currentAnchor.candidateGroupIndex,
      })
      currentLeadingTexts = [trailingTexts[trailingTexts.length - 1] as string]
      currentAnchor = {
        text: unit.text,
        candidateGroupIndex: matchingGroupIndex,
      }
      trailingTexts = []
    }

    if (!currentAnchor) {
      throw new AnswerInterpretationError(
        `No matching middle run matched any candidate group for ${label} in sourceResponse.`,
      )
    }

    if (trailingTexts.length === 0) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_middle_runs requires each run to end with at least one trailing ${unitLabel} after the matched anchor.`,
      )
    }

    runs.push({
      text: [...currentLeadingTexts, currentAnchor.text, ...trailingTexts].join(joiner),
      candidateGroupIndex: currentAnchor.candidateGroupIndex,
    })

    if (sourceResponseState) {
      sourceResponseState.matchingMiddleRuns = runs
    }
    return runs
  }

  function parseEmbeddedMatchingMiddleSourceResponseRuns(
    sourceResponse: string | undefined,
    label: string,
    candidateGroups: string[][],
  ) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_middle_runs requires sourceResponse for ${label}.`,
      )
    }

    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(shared)
    if (tokens.length === 0) {
      return undefined
    }

    const anchors = dependencies.resolveEmbeddedMatchingRunAnchors(
      shared,
      tokens,
      candidateGroups,
      'matching_middle_runs',
    )
    if (anchors.length === 0) {
      return undefined
    }

    if (anchors[0]?.startTokenIndex === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat matching_middle_runs requires each run to start with at least one leading sentence before the matched anchor.',
      )
    }

    const runs: MatchingSourceResponseRun[] = []
    let currentRunStartOriginal = 0

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] as EmbeddedMatchingRunAnchor
      const nextAnchor = anchors[index + 1]
      const trailingTokenCount = tokens.length - anchor.endTokenIndex

      if (index === anchors.length - 1) {
        if (trailingTokenCount === 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat matching_middle_runs requires each run to end with at least one trailing sentence after the matched anchor.',
          )
        }
        runs.push({
          text: dependencies.normalizeEmbeddedMatchingRunText(
            shared.slice(currentRunStartOriginal),
          ),
          candidateGroupIndex: anchor.candidateGroupIndex,
        })
        break
      }

      if (!nextAnchor) {
        break
      }

      if (nextAnchor.startTokenIndex < anchor.endTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_middle_runs found overlapping embedded anchors for different matched consumers.',
        )
      }

      const gapTokenCount = nextAnchor.startTokenIndex - anchor.endTokenIndex
      if (gapTokenCount < 2) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat matching_middle_runs requires at least one trailing sentence before the next matched anchor and at least one leading sentence for that next run.',
        )
      }

      const nextRunLeadingTokenStartOriginal =
        tokens[nextAnchor.startTokenIndex - 1]?.start ?? shared.length
      runs.push({
        text: dependencies.normalizeEmbeddedMatchingRunText(
          shared.slice(currentRunStartOriginal, nextRunLeadingTokenStartOriginal),
        ),
        candidateGroupIndex: anchor.candidateGroupIndex,
      })
      currentRunStartOriginal = nextRunLeadingTokenStartOriginal
    }

    return runs
  }

  function parseMatchingRunSourceResponseUnits(sourceResponse: string | undefined, label: string) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_runs requires sourceResponse for ${label}.`,
      )
    }

    const paragraphs = parseGenericMatchingSourceResponseParagraphUnits(shared)
    if (paragraphs.length > 1) {
      return { units: paragraphs, joiner: '\n\n', unitLabel: 'paragraph' as const }
    }

    const sentences = parseGenericMatchingSourceResponseSentenceUnits(shared)
    if (sentences.length > 1) {
      return { units: sentences, joiner: ' ', unitLabel: 'sentence' as const }
    }

    const clauses = parseGenericMatchingSourceResponseClauseUnits(shared)
    if (clauses.length > 1) {
      return { units: clauses, joiner: ', ', unitLabel: 'clause' as const }
    }

    const normalizedWholeReply = dependencies.normalizeGenericPendingOrMatchingUnitText(shared)
    return {
      units: [
        {
          text: normalizedWholeReply || shared,
          normalizedText: normalizeSourceResponseText(normalizedWholeReply || shared),
        },
      ],
      joiner: ' ',
      unitLabel: 'sentence' as const,
    }
  }

  function findMatchingRunGroupIndexes(
    unit: { normalizedText: string },
    candidateGroups: string[][],
  ) {
    return candidateGroups.flatMap((candidateGroup, index) =>
      dependencies.findMatchingTopicTextUnitIndexes([unit], candidateGroup, new Set<number>())
        .length > 0
        ? [index]
        : [],
    )
  }

  return {
    parseGenericMatchingSourceResponseClauseUnits,
    parseGenericMatchingSourceResponseSentenceUnits,
    parseMatchingClosingSourceResponseRuns,
    parseMatchingMiddleSourceResponseRuns,
    parseMatchingOpeningSourceResponseRuns,
    parseMatchingSourceResponseRuns,
  }
}
