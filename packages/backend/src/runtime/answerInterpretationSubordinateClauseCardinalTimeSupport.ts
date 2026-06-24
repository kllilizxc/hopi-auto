import {
  SUBORDINATE_CLAUSE_ORDINAL_TIME_COMPOUND_TAIL_TOKENS,
  SUBORDINATE_CLAUSE_ORDINAL_TIME_SINGLE_TOKEN_ORDINALS,
  SUBORDINATE_CLAUSE_ORDINAL_TIME_TENS_TOKENS,
  SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TAIL_TOKENS,
  SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TENS_TOKENS,
  SUBORDINATE_CLAUSE_TIME_COUNT_NOUN_LEADING_QUANTIFIER_TOKENS,
  SUBORDINATE_CLAUSE_TIME_DIRECT_TIMES_COUNT_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_LEXICAL_COUNT_HEAD_TOKENS,
  SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS,
  SUBORDINATE_CLAUSE_TIME_PLURAL_QUANTITY_TOKENS,
  SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS,
  SUBORDINATE_CLAUSE_TIME_SINGLE_TOKEN_CARDINAL_TOKENS,
  SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS,
} from './answerInterpretationSubordinateClauseLexicon'

function isOrdinalTimeLeadingToken(token: string | undefined) {
  return Boolean(
    token &&
      (SUBORDINATE_CLAUSE_ORDINAL_TIME_SINGLE_TOKEN_ORDINALS.has(token) ||
        /^\d+(?:st|nd|rd|th)$/i.test(token)),
  )
}

export function matchOrdinalTimeSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]
  const thirdToken = tokens[startIndex + 2]
  const fourthToken = tokens[startIndex + 3]
  const fifthToken = tokens[startIndex + 4]

  if (isOrdinalTimeLeadingToken(firstToken)) {
    if (secondToken === 'time') {
      return 2
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_PLURAL_QUANTITY_TOKENS.has(secondToken) &&
      thirdToken === 'times'
    ) {
      return 3
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS.has(secondToken) &&
      thirdToken === 'of' &&
      fourthToken === 'times'
    ) {
      return 4
    }
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_ORDINAL_TIME_TENS_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_ORDINAL_TIME_COMPOUND_TAIL_TOKENS.has(secondToken)
  ) {
    if (thirdToken === 'time') {
      return 3
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_PLURAL_QUANTITY_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_BARE_OF_TIMES_HEAD_TOKENS.has(thirdToken) &&
      fourthToken === 'of' &&
      fifthToken === 'times'
    ) {
      return 5
    }
  }

  return undefined
}

export function isSingleTokenCardinalTimeLeadingToken(token: string | undefined) {
  return Boolean(
    token &&
      (SUBORDINATE_CLAUSE_TIME_SINGLE_TOKEN_CARDINAL_TOKENS.has(token) || /^\d+$/.test(token)),
  )
}

export function matchTimeCardinalSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TENS_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TAIL_TOKENS.has(secondToken)
  ) {
    return 2
  }

  return isSingleTokenCardinalTimeLeadingToken(firstToken) ? 1 : undefined
}

function getTimeLexicalCountOrder(token: string | undefined) {
  switch (token) {
    case 'once':
      return 1
    case 'twice':
      return 2
    case 'thrice':
      return 3
    default:
      return undefined
  }
}

function matchTimeCardinalRangeSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstCardinalLength = matchTimeCardinalSequenceLengthAt(tokens, startIndex)
  if (firstCardinalLength === undefined || tokens[startIndex + firstCardinalLength] !== 'or') {
    return undefined
  }

  const secondCardinalStartIndex = startIndex + firstCardinalLength + 1
  const secondCardinalLength = matchTimeCardinalSequenceLengthAt(tokens, secondCardinalStartIndex)
  if (secondCardinalLength === undefined) {
    return undefined
  }

  const afterSecondCardinalIndex = secondCardinalStartIndex + secondCardinalLength
  const afterSecondCardinalToken = tokens[afterSecondCardinalIndex]
  const followingToken = tokens[afterSecondCardinalIndex + 1]
  const trailingToken = tokens[afterSecondCardinalIndex + 2]

  if (afterSecondCardinalToken === 'times') {
    return afterSecondCardinalIndex - startIndex + 1
  }

  if (
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(
      afterSecondCardinalToken ?? '',
    ) &&
    followingToken === 'times'
  ) {
    return afterSecondCardinalIndex - startIndex + 2
  }

  if (
    afterSecondCardinalToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(afterSecondCardinalToken)
  ) {
    if (followingToken === 'times') {
      return afterSecondCardinalIndex - startIndex + 2
    }

    if (
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(followingToken ?? '') &&
      trailingToken === 'times'
    ) {
      return afterSecondCardinalIndex - startIndex + 3
    }
  }

  return undefined
}

export function matchCountBasedTimeSubordinateClauseSequenceLengthAt(
  tokens: string[],
  startIndex: number,
): number | undefined {
  const firstToken = tokens[startIndex]
  const secondToken = tokens[startIndex + 1]
  const thirdToken = tokens[startIndex + 2]
  const fourthToken = tokens[startIndex + 3]
  const fifthToken = tokens[startIndex + 4]
  const sixthToken = tokens[startIndex + 5]

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_DIRECT_TIMES_COUNT_HEAD_TOKENS.has(firstToken) &&
    secondToken === 'times'
  ) {
    return 2
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_DIRECT_TIMES_COUNT_HEAD_TOKENS.has(firstToken) &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(secondToken ?? '') &&
    thirdToken === 'times'
  ) {
    return 3
  }

  const firstTokenLexicalCountOrder = firstToken ? getTimeLexicalCountOrder(firstToken) : undefined
  if (
    firstToken &&
    firstTokenLexicalCountOrder !== undefined &&
    SUBORDINATE_CLAUSE_TIME_LEXICAL_COUNT_HEAD_TOKENS.has(firstToken)
  ) {
    if (secondToken === 'more') {
      return 2
    }

    if (
      secondToken === 'or' &&
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_LEXICAL_COUNT_HEAD_TOKENS.has(thirdToken) &&
      getTimeLexicalCountOrder(thirdToken) === firstTokenLexicalCountOrder + 1
    ) {
      if (fourthToken === 'more') {
        return 4
      }

      return 3
    }

    return 1
  }

  const cardinalRangeSequenceLength = matchTimeCardinalRangeSequenceLengthAt(tokens, startIndex)
  if (cardinalRangeSequenceLength !== undefined) {
    return cardinalRangeSequenceLength
  }

  if (isSingleTokenCardinalTimeLeadingToken(firstToken)) {
    if (secondToken === 'times') {
      return 2
    }

    if (
      secondToken === 'or' &&
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
        return 4
      }

      if (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '')) {
        return 5
      }

      return fifthToken === 'times' ? 5 : 6
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(secondToken) &&
      thirdToken === 'times'
    ) {
      return 3
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(secondToken) &&
      thirdToken === 'times'
    ) {
      return 3
    }

    if (
      secondToken &&
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(secondToken) &&
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TENS_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_COMPOUND_CARDINAL_TAIL_TOKENS.has(secondToken)
  ) {
    if (thirdToken === 'times') {
      return 3
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(thirdToken) &&
      fourthToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken) &&
      fifthToken === 'times'
    ) {
      return 5
    }
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_COUNT_NOUN_LEADING_QUANTIFIER_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_SINGULAR_COUNT_NOUN_TOKENS.has(secondToken)
  ) {
    if (thirdToken === 'times') {
      return 3
    }

    if (
      thirdToken &&
      SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(thirdToken) &&
      fourthToken === 'times'
    ) {
      return 4
    }

    if (
      thirdToken === 'and' &&
      fourthToken === 'a' &&
      fifthToken === 'half' &&
      (sixthToken === 'times' ||
        (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(sixthToken ?? '') &&
          tokens[startIndex + 6] === 'times'))
    ) {
      return sixthToken === 'times' ? 6 : 7
    }

    if (thirdToken === 'or') {
      if (
        fourthToken === 'so' &&
        (fifthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fifthToken ?? '') &&
            sixthToken === 'times'))
      ) {
        return fifthToken === 'times' ? 5 : 6
      }

      if (fourthToken === 'more' && fifthToken === 'times') {
        return 5
      }

      const cardinalLength = matchTimeCardinalSequenceLengthAt(tokens, startIndex + 3)
      if (cardinalLength !== undefined) {
        const afterCardinalIndex = startIndex + 3 + cardinalLength
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
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS.has(firstToken) &&
    secondToken === 'of' &&
    thirdToken === 'times'
  ) {
    return 3
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS.has(firstToken) &&
    secondToken &&
    SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(secondToken) &&
    thirdToken === 'times'
  ) {
    return 3
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS.has(firstToken) &&
    secondToken === 'or' &&
    thirdToken &&
    SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(thirdToken) &&
    (fourthToken === 'times' ||
      (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken ?? '') &&
        fifthToken === 'times'))
  ) {
    return fourthToken === 'times' ? 4 : 5
  }

  if (
    firstToken &&
    SUBORDINATE_CLAUSE_TIME_PLURAL_COUNT_NOUN_TOKENS.has(firstToken) &&
    secondToken === 'and' &&
    thirdToken === firstToken &&
    ((fourthToken === 'of' && fifthToken === 'times') ||
      (fourthToken &&
        SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(fourthToken) &&
        fifthToken === 'times') ||
      (fourthToken === 'or' &&
        fifthToken &&
        SUBORDINATE_CLAUSE_TIME_RANGE_OR_APPROXIMATION_TAIL_TOKENS.has(fifthToken) &&
        (sixthToken === 'times' ||
          (SUBORDINATE_CLAUSE_TIME_ARTICLE_LED_OPTIONAL_POST_HEAD_TOKENS.has(sixthToken ?? '') &&
            tokens[startIndex + 6] === 'times'))))
  ) {
    if (fourthToken !== 'or') {
      return 5
    }

    return sixthToken === 'times' ? 6 : 7
  }

  return undefined
}
