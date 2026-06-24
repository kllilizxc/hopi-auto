import {
  NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_PHRASAL_SUPPORT_CHAINS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_SUPPORT_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_COPULA_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_STARTER_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_COPULAR_SUPPORT_MODIFIER_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_COPULAR_SUPPORT_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_NEGATIVE_COPULA_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PHRASAL_SUPPORT_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PREDICATE_LOOKAHEAD,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_CHAIN_LOOKBACK,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_TERMINAL_COPULA_LOOKBACK,
  NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_TOKEN_SEQUENCES,
  NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS,
} from './answerInterpretationNonPunctuatedInterrogativeLexicon'
import type { EmbeddedMatchingRunToken } from './answerInterpretationTypes'

export function isNonPunctuatedWhExistentialStarterToken(token: string | undefined) {
  return Boolean(
    token &&
      (token === 'there' ||
        NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_STARTER_TOKENS.has(token) ||
        NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_COPULA_TOKENS.has(token)),
  )
}

export function isNonPunctuatedWhExistentialSupportVerbToken(token: string | undefined) {
  if (!token) {
    return false
  }

  if (
    NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_TOKENS.has(token) ||
    NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PHRASAL_SUPPORT_TOKENS.has(token) ||
    NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_SUPPORT_TOKENS.has(token)
  ) {
    return true
  }

  return NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_PHRASAL_SUPPORT_CHAINS.some((chain) =>
    chain.verbs.has(token),
  )
}

function looksLikeNonPunctuatedWhExistentialCopularSupportToken(token: string | undefined) {
  return Boolean(
    token &&
      !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) &&
      (NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_COPULAR_SUPPORT_TOKENS.has(token) ||
        /(?:ed|en)$/iu.test(token)),
  )
}

function isNonPunctuatedWhExistentialCopulaToken(token: string | undefined) {
  return Boolean(
    token &&
      (NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
        NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_NEGATIVE_COPULA_TOKENS.has(token)),
  )
}

export function looksLikeNonPunctuatedWhExistentialCopularSupportModifierToken(
  token: string | undefined,
) {
  return Boolean(
    token &&
      !looksLikeNonPunctuatedWhExistentialCopularSupportToken(token) &&
      (NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_COPULAR_SUPPORT_MODIFIER_TOKENS.has(token) ||
        /ly$/iu.test(token)),
  )
}

export function skipNonPunctuatedInterrogativePredicateFillers(
  tokens: EmbeddedMatchingRunToken[],
  tokenIndex: number,
) {
  let nextTokenIndex = tokenIndex
  while (nextTokenIndex < tokens.length) {
    const matchedSequence = NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_TOKEN_SEQUENCES.filter(
      (sequence) =>
        sequence.every(
          (token, sequenceIndex) =>
            tokens[nextTokenIndex + sequenceIndex]?.normalizedText === token,
        ),
    ).sort((leftSequence, rightSequence) => rightSequence.length - leftSequence.length)[0]
    if (matchedSequence) {
      nextTokenIndex += matchedSequence.length
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(
        tokens[nextTokenIndex]?.normalizedText ?? '',
      )
    ) {
      nextTokenIndex += 1
      continue
    }

    break
  }
  return nextTokenIndex
}

function skipNonPunctuatedWhExistentialCopularSupportPrefixes(
  tokens: EmbeddedMatchingRunToken[],
  tokenIndex: number,
) {
  let nextTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex)
  while (
    looksLikeNonPunctuatedWhExistentialCopularSupportModifierToken(
      tokens[nextTokenIndex]?.normalizedText,
    )
  ) {
    nextTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, nextTokenIndex + 1)
  }
  return nextTokenIndex
}

function findNonPunctuatedWhExistentialCopularSupportPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  copulaTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    copulaTokenIndex + 1,
  )
  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    )
  ) {
    const supportChainPredicateIndex = findNonPunctuatedWhExistentialSupportToPredicateIndex(
      tokens,
      supportTokenIndex,
    )
    if (supportChainPredicateIndex !== undefined) {
      return supportChainPredicateIndex
    }
  }

  return undefined
}

function findNonPunctuatedWhExistentialSupportVerbCopularSupportPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  supportVerbTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    supportVerbTokenIndex + 1,
  )
  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    )
  ) {
    const supportChainPredicateIndex = findNonPunctuatedWhExistentialSupportToPredicateIndex(
      tokens,
      supportTokenIndex,
    )
    if (supportChainPredicateIndex !== undefined) {
      return supportChainPredicateIndex
    }
  }

  return undefined
}

function findNonPunctuatedWhExistentialContractedStarterCopularSupportPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  starterTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    starterTokenIndex + 1,
  )
  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    )
  ) {
    const directPredicateTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
      tokens,
      supportTokenIndex + 1,
    )
    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
        tokens[directPredicateTokenIndex]?.normalizedText ?? '',
      )
    ) {
      return directPredicateTokenIndex
    }

    const supportChainPredicateIndex = findNonPunctuatedWhExistentialSupportToPredicateIndex(
      tokens,
      supportTokenIndex,
    )
    if (supportChainPredicateIndex !== undefined) {
      return supportChainPredicateIndex
    }
  }

  return undefined
}

function findNonPunctuatedWhExistentialSupportToPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  supportTokenIndex: number,
) {
  const toTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, supportTokenIndex + 1)
  if (tokens[toTokenIndex]?.normalizedText !== 'to') {
    return undefined
  }

  const continuationTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    toTokenIndex + 1,
  )
  if (
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
      tokens[continuationTokenIndex]?.normalizedText ?? '',
    )
  ) {
    return continuationTokenIndex
  }

  if (
    tokens[continuationTokenIndex]?.normalizedText === 'have' ||
    tokens[continuationTokenIndex]?.normalizedText === 'has' ||
    tokens[continuationTokenIndex]?.normalizedText === 'had'
  ) {
    const perfectCopulaPredicateIndex = findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
      tokens,
      continuationTokenIndex + 1,
    )
    if (perfectCopulaPredicateIndex !== undefined) {
      return perfectCopulaPredicateIndex
    }
  }

  return undefined
}

function findNonPunctuatedWhExistentialContractedStarterPerfectPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  starterTokenIndex: number,
) {
  const firstTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    starterTokenIndex + 1,
  )
  if (tokens[firstTokenIndex]?.normalizedText === 'have') {
    const copulaTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
      tokens,
      firstTokenIndex + 1,
    )
    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(tokens[copulaTokenIndex]?.normalizedText ?? '')
    ) {
      return copulaTokenIndex
    }
  }

  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    starterTokenIndex + 1,
  )
  const perfectAuxiliaryTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    supportTokenIndex + 1,
  )
  const copulaTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    perfectAuxiliaryTokenIndex + 1,
  )

  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    ) &&
    tokens[perfectAuxiliaryTokenIndex]?.normalizedText === 'have' &&
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(tokens[copulaTokenIndex]?.normalizedText ?? '')
  ) {
    return copulaTokenIndex
  }

  return undefined
}

function findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    startTokenIndex,
  )
  if (
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(tokens[supportTokenIndex]?.normalizedText ?? '')
  ) {
    return supportTokenIndex
  }

  const copulaTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    supportTokenIndex + 1,
  )
  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    ) &&
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(tokens[copulaTokenIndex]?.normalizedText ?? '')
  ) {
    return copulaTokenIndex
  }

  return undefined
}

function findNonPunctuatedWhExistentialAuxiliaryPerfectPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  auxiliaryTokenIndex: number,
) {
  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    auxiliaryTokenIndex + 1,
  )
  const perfectAuxiliaryTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    supportTokenIndex + 1,
  )
  const copulaTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    perfectAuxiliaryTokenIndex + 1,
  )

  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    ) &&
    (tokens[perfectAuxiliaryTokenIndex]?.normalizedText === 'have' ||
      tokens[perfectAuxiliaryTokenIndex]?.normalizedText === 'has' ||
      tokens[perfectAuxiliaryTokenIndex]?.normalizedText === 'had') &&
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(tokens[copulaTokenIndex]?.normalizedText ?? '')
  ) {
    return copulaTokenIndex
  }

  return undefined
}

function findNonPunctuatedWhExistentialContractedCopulaPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  starterTokenIndex: number,
) {
  if (tokens[starterTokenIndex]?.normalizedText === "there's") {
    const perfectCopulaPredicateIndex = findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
      tokens,
      starterTokenIndex + 1,
    )
    if (perfectCopulaPredicateIndex !== undefined) {
      return perfectCopulaPredicateIndex
    }
  }

  const firstPredicateTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(
    tokens,
    starterTokenIndex + 1,
  )

  if (
    tokens[firstPredicateTokenIndex]?.normalizedText === 'going' &&
    tokens[firstPredicateTokenIndex + 1]?.normalizedText === 'to' &&
    NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
      tokens[firstPredicateTokenIndex + 2]?.normalizedText ?? '',
    )
  ) {
    return firstPredicateTokenIndex + 2
  }

  const supportTokenIndex = skipNonPunctuatedWhExistentialCopularSupportPrefixes(
    tokens,
    starterTokenIndex + 1,
  )

  if (
    looksLikeNonPunctuatedWhExistentialCopularSupportToken(
      tokens[supportTokenIndex]?.normalizedText,
    )
  ) {
    const supportChainPredicateIndex = findNonPunctuatedWhExistentialSupportToPredicateIndex(
      tokens,
      supportTokenIndex,
    )
    if (supportChainPredicateIndex !== undefined) {
      return supportChainPredicateIndex
    }
  }

  return undefined
}

export function findNonPunctuatedWhExistentialPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  thereTokenIndex: number,
) {
  const starterToken = tokens[thereTokenIndex]?.normalizedText
  if (!isNonPunctuatedWhExistentialStarterToken(starterToken)) {
    return undefined
  }

  if (
    starterToken &&
    NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_COPULA_TOKENS.has(starterToken)
  ) {
    return findNonPunctuatedWhExistentialContractedCopulaPredicateIndex(tokens, thereTokenIndex)
  }

  if (starterToken === "there've") {
    const perfectCopulaPredicateIndex = findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
      tokens,
      thereTokenIndex + 1,
    )
    if (perfectCopulaPredicateIndex !== undefined) {
      return perfectCopulaPredicateIndex
    }
  }

  let lastTokenIndex = Math.min(
    tokens.length - 1,
    thereTokenIndex + NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PREDICATE_LOOKAHEAD,
  )
  for (let tokenIndex = thereTokenIndex + 1; tokenIndex <= lastTokenIndex; tokenIndex += 1) {
    const nonFillerTokenIndex = skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex)
    if (nonFillerTokenIndex !== tokenIndex) {
      lastTokenIndex = Math.max(lastTokenIndex, Math.min(tokens.length - 1, nonFillerTokenIndex))
      tokenIndex = nonFillerTokenIndex - 1
      continue
    }

    const token = tokens[tokenIndex]?.normalizedText
    if (!token || NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token)) {
      continue
    }

    if (
      starterToken &&
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_CONTRACTED_STARTER_TOKENS.has(starterToken)
    ) {
      const contractedStarterPerfectPredicateIndex =
        findNonPunctuatedWhExistentialContractedStarterPerfectPredicateIndex(
          tokens,
          thereTokenIndex,
        )
      if (contractedStarterPerfectPredicateIndex !== undefined) {
        return contractedStarterPerfectPredicateIndex
      }

      const contractedStarterCopularSupportPredicateIndex =
        findNonPunctuatedWhExistentialContractedStarterCopularSupportPredicateIndex(
          tokens,
          thereTokenIndex,
        )
      if (contractedStarterCopularSupportPredicateIndex !== undefined) {
        return contractedStarterCopularSupportPredicateIndex
      }
    }

    if (token === 'have' || token === 'has' || token === 'had') {
      const perfectCopulaPredicateIndex = findNonPunctuatedWhExistentialPerfectCopulaPredicateIndex(
        tokens,
        tokenIndex + 1,
      )
      if (perfectCopulaPredicateIndex !== undefined) {
        return perfectCopulaPredicateIndex
      }
    }

    if (
      isNonPunctuatedWhExistentialCopulaToken(token) &&
      tokens[tokenIndex + 1]?.normalizedText === 'going' &&
      tokens[tokenIndex + 2]?.normalizedText === 'to' &&
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(tokens[tokenIndex + 3]?.normalizedText ?? '')
    ) {
      return tokenIndex + 3
    }

    if (isNonPunctuatedWhExistentialCopulaToken(token)) {
      const copularSupportPredicateIndex =
        findNonPunctuatedWhExistentialCopularSupportPredicateIndex(tokens, tokenIndex)
      if (copularSupportPredicateIndex !== undefined) {
        return copularSupportPredicateIndex
      }
    }

    if (isNonPunctuatedWhExistentialCopulaToken(token)) {
      return tokenIndex
    }

    if (isNonPunctuatedWhExistentialSupportVerbToken(token)) {
      const supportVerbCopularSupportPredicateIndex =
        findNonPunctuatedWhExistentialSupportVerbCopularSupportPredicateIndex(tokens, tokenIndex)
      if (supportVerbCopularSupportPredicateIndex !== undefined) {
        return supportVerbCopularSupportPredicateIndex
      }
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_PHRASAL_SUPPORT_TOKENS.has(token) &&
      tokens[tokenIndex + 1]?.normalizedText === 'out' &&
      tokens[skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2)]
        ?.normalizedText === 'to' &&
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
        tokens[skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2) + 1]
          ?.normalizedText ?? '',
      )
    ) {
      return skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2) + 1
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_SUPPORT_TOKENS.has(token) &&
      tokens[skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 1)]
        ?.normalizedText === 'being'
    ) {
      return skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 1)
    }

    for (const chain of NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_BEING_PHRASAL_SUPPORT_CHAINS) {
      if (
        chain.verbs.has(token) &&
        tokens[tokenIndex + 1]?.normalizedText === chain.particle &&
        tokens[skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2)]
          ?.normalizedText === 'being'
      ) {
        return skipNonPunctuatedInterrogativePredicateFillers(tokens, tokenIndex + 2)
      }
    }

    if (NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token)) {
      const auxiliaryPerfectPredicateIndex =
        findNonPunctuatedWhExistentialAuxiliaryPerfectPredicateIndex(tokens, tokenIndex)
      if (auxiliaryPerfectPredicateIndex !== undefined) {
        return auxiliaryPerfectPredicateIndex
      }
    }

    if (
      token === 'to' ||
      NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_TOKENS.has(token)
    ) {
      continue
    }

    return undefined
  }

  return undefined
}

export function isWithinNonPunctuatedWhExistentialSupportChain(
  tokens: EmbeddedMatchingRunToken[],
  tokenIndex: number,
) {
  const firstThereTokenIndex = Math.max(
    0,
    tokenIndex - NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_CHAIN_LOOKBACK,
  )
  for (
    let thereTokenIndex = firstThereTokenIndex;
    thereTokenIndex < tokenIndex;
    thereTokenIndex += 1
  ) {
    if (!isNonPunctuatedWhExistentialStarterToken(tokens[thereTokenIndex]?.normalizedText)) {
      continue
    }

    const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
      tokens,
      thereTokenIndex,
    )
    if (
      existentialPredicateIndex !== undefined &&
      tokenIndex > thereTokenIndex &&
      tokenIndex < existentialPredicateIndex
    ) {
      return true
    }
  }

  return false
}

export function isNonPunctuatedWhExistentialTerminalCopula(
  tokens: EmbeddedMatchingRunToken[],
  copulaIndex: number,
) {
  if (!NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(tokens[copulaIndex]?.normalizedText ?? '')) {
    return false
  }

  const firstThereTokenIndex = Math.max(
    0,
    copulaIndex - NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_TERMINAL_COPULA_LOOKBACK,
  )
  for (
    let thereTokenIndex = firstThereTokenIndex;
    thereTokenIndex < copulaIndex;
    thereTokenIndex += 1
  ) {
    if (!isNonPunctuatedWhExistentialStarterToken(tokens[thereTokenIndex]?.normalizedText)) {
      continue
    }

    if (findNonPunctuatedWhExistentialPredicateIndex(tokens, thereTokenIndex) === copulaIndex) {
      return true
    }
  }

  return false
}
