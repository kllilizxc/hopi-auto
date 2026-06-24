import {
  findNonPunctuatedWhExistentialPredicateIndex,
  isNonPunctuatedWhExistentialStarterToken,
  isNonPunctuatedWhExistentialSupportVerbToken,
  isNonPunctuatedWhExistentialTerminalCopula,
  isWithinNonPunctuatedWhExistentialSupportChain,
  looksLikeNonPunctuatedWhExistentialCopularSupportModifierToken,
} from './answerInterpretationNonPunctuatedExistentialSupport'
import {
  CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_ADVERB_LEADING_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_LEXICAL_PREDICATE_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_HOW_EMBEDDED_CLAUSE_SECOND_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_HOW_QUESTION_SECOND_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_WH_LEADING_WORDS,
} from './answerInterpretationNonPunctuatedInterrogativeLexicon'
import type { EmbeddedMatchingRunToken } from './answerInterpretationTypes'

type HasNonPunctuatedWhCommaContinuation = (text: string) => boolean

export function looksLikePluralNounInterrogativeSubjectHead(token: string) {
  return (
    /^[a-z][a-z0-9'-]*s$/iu.test(token) &&
    !/['’]s$/iu.test(token) &&
    !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
    !looksLikeNonPunctuatedWhExistentialCopularSupportModifierToken(token) &&
    !isNonPunctuatedWhExistentialSupportVerbToken(token) &&
    !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
    !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token)
  )
}

export function looksLikeNonPunctuatedWhSubjectClausePredicateHead(token: string | undefined) {
  return Boolean(
    token &&
      !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) &&
      (/ed$/iu.test(token) ||
        /en$/iu.test(token) ||
        /ing$/iu.test(token) ||
        (/s$/iu.test(token) && !/['’]s$/iu.test(token))),
  )
}

function looksLikeNonPunctuatedWhSubjectClauseLexicalToken(token: string | undefined) {
  return Boolean(
    token &&
      !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token),
  )
}

function looksLikeNonPunctuatedWhNounPhraseSubjectHeadToken(token: string | undefined) {
  return Boolean(
    token &&
      !isNonPunctuatedWhExistentialStarterToken(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(token) &&
      !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token),
  )
}

function looksLikeNonPunctuatedWhInfinitiveVerbToken(token: string | undefined) {
  return Boolean(
    token &&
      !CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
      !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token),
  )
}

export function tokenLooksLikeNonPunctuatedWhClauseSubject(token: string | undefined) {
  return Boolean(
    token &&
      (CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(token) ||
        looksLikePluralNounInterrogativeSubjectHead(token)),
  )
}

function isNonPunctuatedWhInfinitiveClauseDeclarative(tokens: EmbeddedMatchingRunToken[]) {
  const maxInfinitiveTokenIndex = Math.min(tokens.length - 2, 4)
  for (let tokenIndex = 1; tokenIndex <= maxInfinitiveTokenIndex; tokenIndex += 1) {
    if (tokens[tokenIndex]?.normalizedText !== 'to') {
      continue
    }

    if (!looksLikeNonPunctuatedWhInfinitiveVerbToken(tokens[tokenIndex + 1]?.normalizedText)) {
      continue
    }

    for (
      let laterTokenIndex = tokenIndex + 2;
      laterTokenIndex < tokens.length;
      laterTokenIndex += 1
    ) {
      const laterToken = tokens[laterTokenIndex]?.normalizedText
      if (
        !laterToken ||
        NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(laterToken) ||
        NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(laterToken)
      ) {
        continue
      }

      if (
        NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(laterToken) ||
        looksLikeNonPunctuatedWhSubjectClausePredicateHead(laterToken)
      ) {
        return true
      }
    }
  }

  return false
}

export function findNonPunctuatedWhEmbeddedClausePredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (token && NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_LEXICAL_PREDICATE_TOKENS.has(token)) {
      for (
        let laterTokenIndex = tokenIndex + 1;
        laterTokenIndex < tokens.length;
        laterTokenIndex += 1
      ) {
        const laterToken = tokens[laterTokenIndex]?.normalizedText
        if (
          !laterToken ||
          NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(laterToken) ||
          NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(laterToken)
        ) {
          continue
        }

        if (
          NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(laterToken) ||
          NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(laterToken) ||
          looksLikeNonPunctuatedWhSubjectClausePredicateHead(laterToken)
        ) {
          return tokenIndex
        }

        break
      }
    }

    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) ||
      (tokenLooksLikeNonPunctuatedWhClauseSubject(token) &&
        !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token))
    ) {
      continue
    }

    if (isNonPunctuatedWhExistentialStarterToken(token)) {
      const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
        tokens,
        tokenIndex,
      )
      if (existentialPredicateIndex !== undefined) {
        return existentialPredicateIndex
      }
    }

    return tokenIndex
  }

  return undefined
}

function findNonPunctuatedWhDeclarativeTailPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return tokenIndex
    }
  }

  return undefined
}

function looksLikeNonPunctuatedWhBareClausePredicateToken(token: string | undefined) {
  return Boolean(
    token &&
      !isNonPunctuatedWhExistentialStarterToken(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(token) &&
      !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token) &&
      !looksLikeNonPunctuatedWhNounPhraseSubjectHeadToken(token),
  )
}

export function findNonPunctuatedWhNounPhraseSubjectClauseInnerPredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, tokenIndex)
    ) {
      continue
    }

    if (isNonPunctuatedWhExistentialStarterToken(token)) {
      const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
        tokens,
        tokenIndex,
      )
      if (existentialPredicateIndex !== undefined) {
        return existentialPredicateIndex
      }
    }

    const previousToken = tokens[tokenIndex - 1]?.normalizedText
    if (
      isNonPunctuatedWhExistentialStarterToken(previousToken) &&
      NON_PUNCTUATED_INTERROGATIVE_EXISTENTIAL_SUPPORT_TOKENS.has(token) &&
      tokens[tokenIndex + 1]?.normalizedText === 'to' &&
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(tokens[tokenIndex + 2]?.normalizedText ?? '')
    ) {
      continue
    }

    if (
      looksLikePluralNounInterrogativeSubjectHead(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(previousToken) &&
      (NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(
        tokens[tokenIndex + 1]?.normalizedText ?? '',
      ) ||
        NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(
          tokens[tokenIndex + 1]?.normalizedText ?? '',
        ) ||
        findNonPunctuatedWhExistentialPredicateIndex(tokens, tokenIndex + 1) !== undefined ||
        looksLikeNonPunctuatedWhBareClausePredicateToken(tokens[tokenIndex + 1]?.normalizedText))
    ) {
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return tokenIndex
    }

    if (
      looksLikeNonPunctuatedWhBareClausePredicateToken(token) &&
      (looksLikePluralNounInterrogativeSubjectHead(previousToken ?? '') ||
        tokenLooksLikeNonPunctuatedWhClauseSubject(previousToken))
    ) {
      return tokenIndex
    }
  }

  return undefined
}

export function resolveNonPunctuatedWhOuterPredicateSearchStart(
  tokens: EmbeddedMatchingRunToken[],
  innerPredicateIndex: number,
) {
  const innerPredicateToken = tokens[innerPredicateIndex]?.normalizedText
  return innerPredicateToken &&
    ((NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(innerPredicateToken) &&
      !isNonPunctuatedWhExistentialTerminalCopula(tokens, innerPredicateIndex) &&
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(
        tokens[innerPredicateIndex + 1]?.normalizedText,
      )) ||
      (NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(innerPredicateToken) &&
        looksLikeNonPunctuatedWhSubjectClauseLexicalToken(
          tokens[innerPredicateIndex + 1]?.normalizedText,
        )))
    ? innerPredicateIndex + 2
    : innerPredicateIndex + 1
}

export function findNonPunctuatedWhOuterClausePredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token)
    ) {
      return tokenIndex
    }

    if (
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token) &&
      (tokenIndex === startIndex ||
        !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(
          tokens[tokenIndex - 1]?.normalizedText ?? '',
        ))
    ) {
      return tokenIndex
    }
  }

  return undefined
}

function looksLikeNonPunctuatedHowEmbeddedClauseSubjectToken(token: string | undefined) {
  return Boolean(
    token &&
      (tokenLooksLikeNonPunctuatedWhClauseSubject(token) ||
        (!isNonPunctuatedWhExistentialStarterToken(token) &&
          !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) &&
          !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
          !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) &&
          !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token))),
  )
}

function isNonPunctuatedWhEmbeddedSubjectClauseDeclarative(tokens: EmbeddedMatchingRunToken[]) {
  const maxSubjectIndex = Math.min(tokens.length - 3, 5)
  for (let subjectIndex = 1; subjectIndex <= maxSubjectIndex; subjectIndex += 1) {
    const subjectToken = tokens[subjectIndex]?.normalizedText
    if (
      !tokenLooksLikeNonPunctuatedWhClauseSubject(subjectToken) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, subjectIndex)
    ) {
      continue
    }

    const innerPredicateIndex = findNonPunctuatedWhEmbeddedClausePredicateIndex(
      tokens,
      subjectIndex + 1,
    )
    if (innerPredicateIndex === undefined) {
      continue
    }

    const outerPredicateIndex = findNonPunctuatedWhDeclarativeTailPredicateIndex(
      tokens,
      innerPredicateIndex + 1,
    )
    if (outerPredicateIndex !== undefined) {
      return true
    }
  }

  return false
}

function isNonPunctuatedWhNounPhraseSubjectClauseDeclarative(tokens: EmbeddedMatchingRunToken[]) {
  const maxSubjectHeadIndex = Math.min(tokens.length - 3, 4)
  for (let subjectHeadIndex = 1; subjectHeadIndex <= maxSubjectHeadIndex; subjectHeadIndex += 1) {
    const subjectHeadToken = tokens[subjectHeadIndex]?.normalizedText
    if (!looksLikeNonPunctuatedWhNounPhraseSubjectHeadToken(subjectHeadToken)) {
      continue
    }

    const innerPredicateIndex = findNonPunctuatedWhNounPhraseSubjectClauseInnerPredicateIndex(
      tokens,
      subjectHeadIndex + 1,
    )
    if (innerPredicateIndex === undefined) {
      continue
    }

    const outerPredicateIndex = findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, innerPredicateIndex),
    )
    if (outerPredicateIndex !== undefined) {
      return true
    }
  }

  return false
}

function findNonPunctuatedWhAdverbClauseInnerPredicateIndex(tokens: EmbeddedMatchingRunToken[]) {
  const predicateIndex = findNonPunctuatedWhDeclarativeTailPredicateIndex(tokens, 2)
  if (predicateIndex !== undefined) {
    return predicateIndex
  }

  if (
    tokenLooksLikeNonPunctuatedWhClauseSubject(tokens[1]?.normalizedText) &&
    looksLikeNonPunctuatedWhSubjectClauseLexicalToken(tokens[2]?.normalizedText)
  ) {
    return 2
  }

  return undefined
}

function isNonPunctuatedWhAdverbClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
  text: string,
  hasNonPunctuatedWhCommaContinuation: HasNonPunctuatedWhCommaContinuation,
) {
  const leadingWord = tokens[0]?.normalizedText
  const secondToken = tokens[1]?.normalizedText
  if (
    !leadingWord ||
    !NON_PUNCTUATED_INTERROGATIVE_ADVERB_LEADING_WORDS.has(leadingWord) ||
    NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(secondToken ?? '')
  ) {
    return false
  }

  if (hasNonPunctuatedWhCommaContinuation(text)) {
    return true
  }

  const innerPredicateIndex = findNonPunctuatedWhAdverbClauseInnerPredicateIndex(tokens)
  if (innerPredicateIndex === undefined) {
    return false
  }

  return (
    findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, innerPredicateIndex),
    ) !== undefined
  )
}

function findNonPunctuatedHowEmbeddedClausePredicateIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, tokenIndex)
    ) {
      continue
    }

    if (isNonPunctuatedWhExistentialStarterToken(token)) {
      const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
        tokens,
        tokenIndex,
      )
      if (existentialPredicateIndex !== undefined) {
        return existentialPredicateIndex
      }
    }

    const previousToken = tokens[tokenIndex - 1]?.normalizedText
    if (
      looksLikePluralNounInterrogativeSubjectHead(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(previousToken) &&
      findNonPunctuatedWhExistentialPredicateIndex(tokens, tokenIndex + 1) !== undefined
    ) {
      continue
    }

    if (
      looksLikeNonPunctuatedWhNounPhraseSubjectHeadToken(token) &&
      looksLikeNonPunctuatedWhSubjectClauseLexicalToken(previousToken) &&
      findNonPunctuatedWhExistentialPredicateIndex(tokens, tokenIndex + 1) !== undefined
    ) {
      continue
    }

    if (
      (token === 'have' || token === 'has' || token === 'had') &&
      tokenLooksLikeNonPunctuatedWhClauseSubject(tokens[tokenIndex - 1]?.normalizedText)
    ) {
      return tokenIndex
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(token) ||
      (tokenLooksLikeNonPunctuatedWhClauseSubject(token) &&
        !looksLikeNonPunctuatedWhSubjectClausePredicateHead(token))
    ) {
      continue
    }

    return tokenIndex
  }

  return undefined
}

function isNonPunctuatedHowModifierEmbeddedClauseDeclarative(tokens: EmbeddedMatchingRunToken[]) {
  if (
    tokens[0]?.normalizedText !== 'how' ||
    !NON_PUNCTUATED_INTERROGATIVE_HOW_EMBEDDED_CLAUSE_SECOND_WORDS.has(
      tokens[1]?.normalizedText ?? '',
    )
  ) {
    return false
  }

  const maxSubjectIndex = Math.min(tokens.length - 3, 5)
  for (let subjectIndex = 2; subjectIndex <= maxSubjectIndex; subjectIndex += 1) {
    const subjectToken = tokens[subjectIndex]?.normalizedText
    if (
      !looksLikeNonPunctuatedHowEmbeddedClauseSubjectToken(subjectToken) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, subjectIndex)
    ) {
      continue
    }

    const innerPredicateIndex = findNonPunctuatedHowEmbeddedClausePredicateIndex(
      tokens,
      subjectIndex + 1,
    )
    if (innerPredicateIndex === undefined) {
      continue
    }

    const outerPredicateIndex = findNonPunctuatedWhDeclarativeTailPredicateIndex(
      tokens,
      innerPredicateIndex + 1,
    )
    if (outerPredicateIndex !== undefined) {
      return true
    }
  }

  return false
}

function isNonPunctuatedWhLeadingExistentialClauseDeclarative(tokens: EmbeddedMatchingRunToken[]) {
  if (!isNonPunctuatedWhExistentialStarterToken(tokens[1]?.normalizedText)) {
    return false
  }

  const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(tokens, 1)
  if (existentialPredicateIndex === undefined) {
    return false
  }

  return (
    findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, existentialPredicateIndex),
    ) !== undefined
  )
}

export function findNonPunctuatedWhClauseExistentialStarterIndex(
  tokens: EmbeddedMatchingRunToken[],
  startIndex: number,
) {
  for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) ||
      isWithinNonPunctuatedWhExistentialSupportChain(tokens, tokenIndex)
    ) {
      continue
    }

    if (isNonPunctuatedWhExistentialStarterToken(token)) {
      return tokenIndex
    }
  }

  return undefined
}

export function resolveNonPunctuatedWhExistentialClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
  starterTokenIndex: number,
) {
  if (!isNonPunctuatedWhExistentialStarterToken(tokens[starterTokenIndex]?.normalizedText)) {
    return undefined
  }

  const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
    tokens,
    starterTokenIndex,
  )
  if (existentialPredicateIndex === undefined) {
    return undefined
  }

  return (
    findNonPunctuatedWhOuterClausePredicateIndex(
      tokens,
      resolveNonPunctuatedWhOuterPredicateSearchStart(tokens, existentialPredicateIndex),
    ) !== undefined
  )
}

export function isAuxiliaryLedExistentialPluralComplementQuestion(
  tokens: EmbeddedMatchingRunToken[],
  leadingWord: string,
  existentialStarterIndex: number,
) {
  if (
    existentialStarterIndex !== 1 ||
    !(
      NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(leadingWord) ||
      leadingWord === "don't" ||
      leadingWord === 'need'
    )
  ) {
    return false
  }

  const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
    tokens,
    existentialStarterIndex,
  )
  if (existentialPredicateIndex === undefined) {
    return false
  }

  let sawPluralComplementHead = false
  for (
    let tokenIndex = existentialPredicateIndex + 1;
    tokenIndex < tokens.length;
    tokenIndex += 1
  ) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (!sawPluralComplementHead) {
      if (looksLikePluralNounInterrogativeSubjectHead(token)) {
        sawPluralComplementHead = true
      }
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token) ||
      isNonPunctuatedWhExistentialStarterToken(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return false
    }
  }

  return sawPluralComplementHead
}

export function isAdverbLedExistentialPluralComplementQuestion(
  tokens: EmbeddedMatchingRunToken[],
  leadingWord: string,
  existentialStarterIndex: number,
) {
  if (
    existentialStarterIndex !== 1 ||
    !NON_PUNCTUATED_INTERROGATIVE_ADVERB_LEADING_WORDS.has(leadingWord)
  ) {
    return false
  }

  const existentialPredicateIndex = findNonPunctuatedWhExistentialPredicateIndex(
    tokens,
    existentialStarterIndex,
  )
  if (existentialPredicateIndex === undefined) {
    return false
  }

  let sawPluralComplementHead = false
  for (
    let tokenIndex = existentialPredicateIndex + 1;
    tokenIndex < tokens.length;
    tokenIndex += 1
  ) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (!sawPluralComplementHead) {
      if (looksLikePluralNounInterrogativeSubjectHead(token)) {
        sawPluralComplementHead = true
      }
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token) ||
      isNonPunctuatedWhExistentialStarterToken(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return false
    }
  }

  return sawPluralComplementHead
}

export function hasBareExistentialPluralComplementTail(
  tokens: EmbeddedMatchingRunToken[],
  existentialPredicateIndex: number,
) {
  let sawPluralComplementHead = false
  for (
    let tokenIndex = existentialPredicateIndex + 1;
    tokenIndex < tokens.length;
    tokenIndex += 1
  ) {
    const token = tokens[tokenIndex]?.normalizedText
    if (
      !token ||
      NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token)
    ) {
      continue
    }

    if (!sawPluralComplementHead) {
      if (looksLikePluralNounInterrogativeSubjectHead(token)) {
        sawPluralComplementHead = true
      }
      continue
    }

    if (
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token) ||
      NON_PUNCTUATED_INTERROGATIVE_LINKING_PREDICATE_TOKENS.has(token) ||
      isNonPunctuatedWhExistentialStarterToken(token) ||
      looksLikeNonPunctuatedWhSubjectClausePredicateHead(token)
    ) {
      return false
    }
  }

  return sawPluralComplementHead
}

export function isNonPunctuatedWhClauseDeclarative(
  tokens: EmbeddedMatchingRunToken[],
  leadingWord: string,
  text: string,
  hasNonPunctuatedWhCommaContinuation: HasNonPunctuatedWhCommaContinuation,
) {
  if (!NON_PUNCTUATED_INTERROGATIVE_WH_LEADING_WORDS.has(leadingWord)) {
    return false
  }

  const secondToken = tokens[1]?.normalizedText
  const existentialStarterIndex = findNonPunctuatedWhClauseExistentialStarterIndex(tokens, 1)
  if (existentialStarterIndex !== undefined) {
    const existentialClauseDeclarative = resolveNonPunctuatedWhExistentialClauseDeclarative(
      tokens,
      existentialStarterIndex,
    )
    if (existentialClauseDeclarative !== undefined) {
      if (
        existentialClauseDeclarative &&
        isAdverbLedExistentialPluralComplementQuestion(tokens, leadingWord, existentialStarterIndex)
      ) {
        return false
      }
      return existentialClauseDeclarative
    }
  }
  if (isNonPunctuatedWhInfinitiveClauseDeclarative(tokens)) {
    return true
  }
  if (isNonPunctuatedHowModifierEmbeddedClauseDeclarative(tokens)) {
    return true
  }
  if (
    !(
      leadingWord === 'how' &&
      NON_PUNCTUATED_INTERROGATIVE_HOW_EMBEDDED_CLAUSE_SECOND_WORDS.has(secondToken ?? '')
    ) &&
    isNonPunctuatedWhEmbeddedSubjectClauseDeclarative(tokens)
  ) {
    return true
  }
  if (isNonPunctuatedWhLeadingExistentialClauseDeclarative(tokens)) {
    return true
  }
  if (leadingWord !== 'how' && isNonPunctuatedWhNounPhraseSubjectClauseDeclarative(tokens)) {
    return true
  }

  const firstDelayedCopulaIndex = tokens.findIndex(
    (token, tokenIndex) =>
      tokenIndex >= 2 &&
      NON_PUNCTUATED_INTERROGATIVE_COPULA_TOKENS.has(token.normalizedText) &&
      !isNonPunctuatedWhExistentialTerminalCopula(tokens, tokenIndex),
  )
  if (firstDelayedCopulaIndex >= 3) {
    for (let tokenIndex = 1; tokenIndex < firstDelayedCopulaIndex - 1; tokenIndex += 1) {
      if (tokens[tokenIndex]?.normalizedText !== 'to') {
        continue
      }

      if (
        looksLikeNonPunctuatedWhSubjectClauseLexicalToken(tokens[tokenIndex + 1]?.normalizedText)
      ) {
        return true
      }
    }
  }

  if (
    firstDelayedCopulaIndex >= 2 &&
    looksLikeNonPunctuatedWhSubjectClausePredicateHead(tokens[1]?.normalizedText) &&
    !(
      isNonPunctuatedWhExistentialStarterToken(tokens[2]?.normalizedText) &&
      findNonPunctuatedWhExistentialPredicateIndex(tokens, 2) !== undefined
    )
  ) {
    return true
  }

  if (firstDelayedCopulaIndex >= 3) {
    let sawClauseSubject = false
    for (let tokenIndex = 1; tokenIndex < firstDelayedCopulaIndex; tokenIndex += 1) {
      const token = tokens[tokenIndex]?.normalizedText
      if (!token) {
        continue
      }

      if (!sawClauseSubject && tokenLooksLikeNonPunctuatedWhClauseSubject(token)) {
        sawClauseSubject = true
        continue
      }

      if (sawClauseSubject && isWithinNonPunctuatedWhExistentialSupportChain(tokens, tokenIndex)) {
        continue
      }

      if (
        sawClauseSubject &&
        (looksLikeNonPunctuatedWhSubjectClausePredicateHead(token) ||
          looksLikeNonPunctuatedWhBareClausePredicateToken(token))
      ) {
        return true
      }
    }
  }

  if (
    leadingWord === 'how' &&
    NON_PUNCTUATED_INTERROGATIVE_HOW_QUESTION_SECOND_WORDS.has(secondToken ?? '')
  ) {
    return false
  }

  if (isNonPunctuatedWhAdverbClauseDeclarative(tokens, text, hasNonPunctuatedWhCommaContinuation)) {
    return true
  }

  return false
}
