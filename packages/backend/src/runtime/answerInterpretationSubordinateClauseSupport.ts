import { normalizeSourceResponseLabel } from './answerInterpretationStrings'
import {
  MULTI_TOKEN_SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES,
  SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES,
} from './answerInterpretationSubordinateClauseLexicon'
import {
  matchArticleStrippedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt,
  matchDurationUnitTemporalPhraseSequenceLengthAt,
  matchGenericTimeSubordinateClauseSequenceLengthAt,
  matchPrepositionalTimeSubordinateClauseSequenceLengthAt,
} from './answerInterpretationSubordinateClauseQuantifiedTimeSupport'

function matchLeadingTokenSequenceLength(
  tokens: string[],
  sequences: readonly (readonly string[])[],
) {
  let bestMatchLength: number | undefined

  for (const sequence of sequences) {
    if (sequence.length > tokens.length) {
      continue
    }

    let matches = true
    for (let index = 0; index < sequence.length; index += 1) {
      if (tokens[index] !== sequence[index]) {
        matches = false
        break
      }
    }

    if (matches) {
      bestMatchLength = Math.max(bestMatchLength ?? 0, sequence.length)
    }
  }

  return bestMatchLength
}

function matchThePrefixedGenericTimeSequenceLength(tokens: string[]) {
  if (tokens[0] !== 'the') {
    return undefined
  }

  const articleStrippedSequenceLength = matchGenericTimeSubordinateClauseSequenceLengthAt(tokens, 1)
  return articleStrippedSequenceLength !== undefined ? articleStrippedSequenceLength + 1 : undefined
}

function matchLeadingTimeSubordinateClauseSequenceLength(tokens: string[]) {
  return (
    matchDurationUnitTemporalPhraseSequenceLengthAt(tokens, 0) ??
    matchPrepositionalTimeSubordinateClauseSequenceLengthAt(tokens, 0) ??
    matchArticleStrippedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(tokens, 0) ??
    matchThePrefixedGenericTimeSequenceLength(tokens) ??
    matchGenericTimeSubordinateClauseSequenceLengthAt(tokens, 0)
  )
}

export function matchLeadingSubordinateClauseSequenceLength(tokens: string[]) {
  return (
    matchLeadingTokenSequenceLength(tokens, SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES) ??
    matchLeadingTimeSubordinateClauseSequenceLength(tokens)
  )
}

export function startsWithMultiTokenSubordinateClauseSequence(tokens: string[]) {
  const leadingSequenceLength =
    matchLeadingTokenSequenceLength(
      tokens,
      MULTI_TOKEN_SUBORDINATE_CLAUSE_LEADING_TOKEN_SEQUENCES,
    ) ?? matchLeadingTimeSubordinateClauseSequenceLength(tokens)

  return leadingSequenceLength !== undefined && leadingSequenceLength > 1
}

export function sourceResponseStartsWithProtectedLeadingConjunctionSequence(
  sourceResponse: string,
) {
  const normalizedLabel = normalizeSourceResponseLabel(sourceResponse)
  if (!normalizedLabel) {
    return false
  }

  const tokens = normalizedLabel.split(' ').filter(Boolean)
  const leadingSequenceLength = matchLeadingSubordinateClauseSequenceLength(tokens)
  if (leadingSequenceLength === undefined) {
    return false
  }

  const leadingTokens = tokens.slice(0, leadingSequenceLength)
  return leadingTokens.includes('and') || leadingTokens.includes('then')
}
