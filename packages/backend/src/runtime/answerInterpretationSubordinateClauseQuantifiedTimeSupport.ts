import {
  SUBORDINATE_CLAUSE_PREPOSITIONAL_TIME_LEADING_TOKENS,
  SUBORDINATE_CLAUSE_PREPOSITIONAL_TIME_POINT_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OF_TIMES_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_MODIFIER_TOKENS,
  SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_DIRECT_THE_TIME_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_DURATION_HORIZON_MODIFIER_TOKENS,
  SUBORDINATE_CLAUSE_TIME_DURATION_UNIT_TOKENS,
  SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_MIDDLE_TOKENS,
  SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_PREFIX_TOKENS,
  SUBORDINATE_CLAUSE_TIME_LEADING_SIMPLE_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_OF_THE_TIME_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_OF_TIMES_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_PRE_ARTICLE_PREFIX_TOKENS,
  SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS,
  SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS,
} from './answerInterpretationSubordinateClauseLexicon'
import {
  isSingleTokenCardinalTimeLeadingToken,
  matchCountBasedTimeSubordinateClauseSequenceLengthAt,
  matchOrdinalTimeSubordinateClauseSequenceLengthAt,
  matchTimeCardinalSequenceLengthAt,
} from './answerInterpretationSubordinateClauseCardinalTimeSupport'

export function matchGenericTimeSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  let tokenIndex = startIndex

  while (
    tokenIndex < tokens.length &&
    SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_PREFIX_TOKENS.has(tokens[tokenIndex] ?? '')
  ) {
    tokenIndex += 1
  }

  if (tokenIndex >= tokens.length) {
    return undefined
  }

  const simpleHeadToken = tokens[tokenIndex]
  if (simpleHeadToken && SUBORDINATE_CLAUSE_TIME_LEADING_SIMPLE_HEAD_TOKENS.has(simpleHeadToken)) {
    let nounIndex = tokenIndex + 1

    while (
      nounIndex < tokens.length &&
      SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_MIDDLE_TOKENS.has(tokens[nounIndex] ?? '')
    ) {
      nounIndex += 1
    }

    const nounToken = tokens[nounIndex]
    const previousToken = tokens[nounIndex - 1]
    if (nounToken === 'time') {
      if (simpleHeadToken === 'some') {
        return previousToken === 'other' || previousToken === 'some'
          ? nounIndex - startIndex + 1
          : undefined
      }

      if (simpleHeadToken === 'most') {
        return previousToken === 'every' ? nounIndex - startIndex + 1 : undefined
      }

      return nounIndex - startIndex + 1
    }

    if (
      nounToken === 'times' &&
      (simpleHeadToken === 'many' ||
        simpleHeadToken === 'most' ||
        simpleHeadToken === 'several' ||
        simpleHeadToken === 'some' ||
        SUBORDINATE_CLAUSE_TIME_LEADING_OPTIONAL_MIDDLE_TOKENS.has(tokens[nounIndex - 1] ?? ''))
    ) {
      return nounIndex - startIndex + 1
    }

    if (
      nounToken === 'of' &&
      previousToken &&
      SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS.has(previousToken) &&
      tokens[nounIndex + 1] === 'times'
    ) {
      return nounIndex - startIndex + 2
    }

    if (
      nounToken &&
      SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS.has(nounToken) &&
      tokens[nounIndex + 1] === 'of' &&
      tokens[nounIndex + 2] === 'times'
    ) {
      return nounIndex - startIndex + 3
    }
  }

  const ordinalTimeSequenceLength = matchOrdinalTimeSubordinateClauseSequenceLengthAt(
    tokens,
    tokenIndex,
  )
  if (ordinalTimeSequenceLength !== undefined) {
    return tokenIndex - startIndex + ordinalTimeSequenceLength
  }

  const quantifiedTimeSequenceLength = matchQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
    tokens,
    tokenIndex,
  )
  if (quantifiedTimeSequenceLength !== undefined) {
    return tokenIndex - startIndex + quantifiedTimeSequenceLength
  }

  return undefined
}

export function matchDurationUnitTemporalPhraseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
) {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]
  const thirdToken = tokens[startIndex + 2]
  const fourthToken = tokens[startIndex + 3]

  if (
    firstToken === 'for' &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_DURATION_UNIT_TOKENS.has(secondToken)
  ) {
    return 2
  }

  if (
    firstToken === 'over' &&
    secondToken === 'the' &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_DURATION_UNIT_TOKENS.has(thirdToken)
  ) {
    return 3
  }

  if (
    firstToken === 'over' &&
    secondToken === 'the' &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_DURATION_HORIZON_MODIFIER_TOKENS.has(thirdToken) &&
    fourthToken === 'term'
  ) {
    return 4
  }

  if (
    firstToken === 'in' &&
    secondToken === 'recent' &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_DURATION_UNIT_TOKENS.has(thirdToken)
  ) {
    return 3
  }

  return undefined
}

function matchQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]
  const thirdToken = tokens[startIndex + 2]
  const fourthToken = tokens[startIndex + 3]
  const fifthToken = tokens[startIndex + 4]

  if (
    firstToken === 'half' &&
    (secondToken === 'a' || secondToken === 'an') &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(thirdToken) &&
    (fourthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '') &&
        fifthToken === 'times'))
  ) {
    return fourthToken === 'times' ? 4 : 5
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_DIRECT_THE_TIME_HEAD_TOKENS.has(firstToken) &&
    secondToken === 'the' &&
    thirdToken === 'time'
  ) {
    return 3
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_OF_THE_TIME_HEAD_TOKENS.has(firstToken) &&
    secondToken === 'of' &&
    thirdToken === 'the' &&
    fourthToken === 'time'
  ) {
    return 4
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_OF_TIMES_HEAD_TOKENS.has(firstToken) &&
    secondToken === 'of' &&
    thirdToken === 'times'
  ) {
    return 3
  }

  const countBasedSequenceLength = matchCountBasedTimeSubordinateClauseSequenceLengthAt(
    tokens,
    startIndex,
  )
  if (countBasedSequenceLength !== undefined) {
    return countBasedSequenceLength
  }

  const articleLedSequenceLength =
    matchArticleLedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(tokens, startIndex)
  if (articleLedSequenceLength !== undefined) {
    return articleLedSequenceLength
  }

  if (
    firstToken === 'the' &&
    (secondToken === 'other' || secondToken === 'same') &&
    thirdToken === 'time'
  ) {
    return 3
  }

  if (
    firstToken === 'at' &&
    secondToken === 'the' &&
    thirdToken === 'same' &&
    fourthToken === 'time'
  ) {
    return 4
  }

  if (
    firstToken === 'by' &&
    secondToken === 'the' &&
    thirdToken === 'same' &&
    fourthToken === 'time'
  ) {
    return 4
  }

  if ((firstToken === 'for' || firstToken === 'from') && secondToken === 'the') {
    const prepositionalTimeSequenceLength = matchGenericTimeSubordinateClauseSequenceLengthAt(
      tokens,
      startIndex + 2,
    )
    if (prepositionalTimeSequenceLength !== undefined) {
      return prepositionalTimeSequenceLength + 2
    }
  }

  return undefined
}

function matchArticleLedQuantifiedTimeHeadSequenceLengthAt(
  tokens: string[],
  startIndex: number,
  headIndex: number,
): number | undefined {
  const headToken = tokens[headIndex]
  const nextToken = tokens[headIndex + 1]
  const thirdToken = tokens[headIndex + 2]
  const fourthToken = tokens[headIndex + 3]
  const fifthToken = tokens[headIndex + 4]
  const sixthToken = tokens[headIndex + 5]
  const seventhToken = tokens[headIndex + 6]

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS.has(headToken) &&
    nextToken === 'times'
  ) {
    return headIndex - startIndex + 2
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken === 'times'
  ) {
    return headIndex - startIndex + 3
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(thirdToken) &&
    fourthToken === 'times'
  ) {
    return headIndex - startIndex + 4
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken === 'and' &&
    fourthToken === 'a' &&
    fifthToken === 'half' &&
    (sixthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(sixthToken ?? '') &&
        seventhToken === 'times'))
  ) {
    return headIndex - startIndex + (sixthToken === 'times' ? 6 : 7)
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken === 'or' &&
    fourthToken &&
    SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(fourthToken) &&
    (fifthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fifthToken ?? '') &&
        sixthToken === 'times'))
  ) {
    return headIndex - startIndex + (fifthToken === 'times' ? 5 : 6)
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_COUNT_NOUN_LEADING_HEAD_TOKENS.has(headToken) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(nextToken) &&
    thirdToken === 'or'
  ) {
    const cardinalRangeLength = matchTimeCardinalSequenceLengthAt(tokens, headIndex + 3)
    if (cardinalRangeLength !== undefined) {
      const afterCardinalIndex = headIndex + 3 + cardinalRangeLength
      if (tokens[afterCardinalIndex] === 'times') {
        return afterCardinalIndex - startIndex + 1
      }

      if (
        SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
          tokens[afterCardinalIndex] ?? '',
        ) &&
        tokens[afterCardinalIndex + 1] === 'times'
      ) {
        return afterCardinalIndex - startIndex + 2
      }
    }
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS.has(headToken) &&
    nextToken === 'or' &&
    isSingleTokenCardinalTimeLeadingToken(thirdToken) &&
    (fourthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '') &&
        fifthToken === 'times') ||
      (fourthToken &&
        SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(fourthToken) &&
        (fifthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fifthToken ?? '') &&
            sixthToken === 'times'))))
  ) {
    if (fourthToken === 'times') {
      return headIndex - startIndex + 4
    }

    if (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '')) {
      return headIndex - startIndex + 5
    }

    return headIndex - startIndex + (fifthToken === 'times' ? 5 : 6)
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(headToken) &&
    nextToken === 'or' &&
    ((thirdToken &&
      SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(thirdToken) &&
      (fourthToken === 'times' ||
        (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
          fourthToken ?? '',
        ) &&
          fifthToken === 'times'))) ||
      (isSingleTokenCardinalTimeLeadingToken(thirdToken) &&
        (fourthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
            fourthToken ?? '',
          ) &&
            fifthToken === 'times'))))
  ) {
    return headIndex - startIndex + (fourthToken === 'times' ? 4 : 5)
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(headToken) &&
    nextToken === 'and' &&
    thirdToken === 'a' &&
    fourthToken === 'half' &&
    (fifthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fifthToken ?? '') &&
        sixthToken === 'times'))
  ) {
    return headIndex - startIndex + (fifthToken === 'times' ? 5 : 6)
  }

  if (
    headToken &&
    (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_DIRECT_TIMES_HEAD_TOKENS.has(headToken) ||
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(headToken)) &&
    nextToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(nextToken) &&
    thirdToken === 'times'
  ) {
    return headIndex - startIndex + 3
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(headToken) &&
    nextToken === 'times'
  ) {
    return headIndex - startIndex + 2
  }

  if (
    headToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OF_TIMES_HEAD_TOKENS.has(headToken) &&
    nextToken === 'of' &&
    thirdToken === 'times'
  ) {
    return headIndex - startIndex + 3
  }

  return undefined
}

function matchArticleLedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const articleToken = tokens[startIndex]
  if (articleToken !== 'a' && articleToken !== 'an') {
    return undefined
  }

  let headIndex = startIndex + 1
  while (
    headIndex < tokens.length &&
    isArticleLedQuantifiedTimeModifierToken(tokens[headIndex])
  ) {
    headIndex += 1
  }

  const ordinalSequenceLength = matchOrdinalTimeSubordinateClauseSequenceLengthAt(tokens, headIndex)
  if (ordinalSequenceLength !== undefined) {
    return headIndex - startIndex + ordinalSequenceLength
  }

  return matchArticleLedQuantifiedTimeHeadSequenceLengthAt(tokens, startIndex, headIndex)
}

export function matchArticleStrippedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  let headIndex = startIndex

  while (
    headIndex < tokens.length &&
    SUBORDINATE_CLAUSE_TIME_PRE_ARTICLE_PREFIX_TOKENS.has(tokens[headIndex] ?? '')
  ) {
    headIndex += 1
  }

  const articleLedSequenceLength =
    matchArticleLedQuantifiedTimePhraseSubordinateClauseSequenceLengthAt(tokens, headIndex)
  if (articleLedSequenceLength !== undefined) {
    return headIndex - startIndex + articleLedSequenceLength
  }

  while (headIndex < tokens.length && isArticleLedQuantifiedTimeModifierToken(tokens[headIndex])) {
    headIndex += 1
  }

  return matchArticleLedQuantifiedTimeHeadSequenceLengthAt(tokens, startIndex, headIndex)
}

function isArticleLedQuantifiedTimeModifierToken(token: string | undefined) {
  return Boolean(
    token &&
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_MODIFIER_TOKENS.has(token) ||
        /^[a-z]+ly$/i.test(token)),
  )
}

export function matchPrepositionalTimeSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstToken = tokens[startIndex]
  if (!firstToken || !SUBORDINATE_CLAUSE_PREPOSITIONAL_TIME_LEADING_TOKENS.has(firstToken)) {
    return undefined
  }

  const nestedGenericTimeSequenceLength = matchGenericTimeSubordinateClauseSequenceLengthAt(
    tokens,
    startIndex + 1,
  )
  if (nestedGenericTimeSequenceLength !== undefined) {
    return nestedGenericTimeSequenceLength + 1
  }

  const articleToken = tokens[startIndex + 1]
  if (articleToken !== 'the' && articleToken !== 'a' && articleToken !== 'an') {
    return undefined
  }

  if (articleToken === 'a' || articleToken === 'an') {
    const articleLedOrdinalSequenceLength = matchOrdinalTimeSubordinateClauseSequenceLengthAt(
      tokens,
      startIndex + 2,
    )
    if (articleLedOrdinalSequenceLength !== undefined) {
      return articleLedOrdinalSequenceLength + 2
    }

    return undefined
  }

  const pointHeadToken = tokens[startIndex + 2]
  if (
    pointHeadToken &&
    SUBORDINATE_CLAUSE_PREPOSITIONAL_TIME_POINT_HEAD_TOKENS.has(pointHeadToken)
  ) {
    return 3
  }

  const nestedTimeSequenceLength = matchGenericTimeSubordinateClauseSequenceLengthAt(
    tokens,
    startIndex + 2,
  )
  if (nestedTimeSequenceLength !== undefined) {
    return nestedTimeSequenceLength + 2
  }

  return undefined
}
