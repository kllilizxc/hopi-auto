import { dedupeNonEmptyStrings } from './answerInterpretationStrings'
import {
  CONTEXTUAL_BARE_HAVE_PARTICIPLE_PREDICATE_WORDS,
  CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS,
  CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS,
  NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS,
  NON_PUNCTUATED_INTERROGATIVE_WH_LEADING_WORDS,
} from './answerInterpretationNonPunctuatedInterrogativeLexicon'
import {
  findNonPunctuatedWhClauseExistentialStarterIndex,
  isAdverbLedExistentialPluralComplementQuestion,
  isAuxiliaryLedExistentialPluralComplementQuestion,
  isNonPunctuatedWhClauseDeclarative,
  looksLikeNonPunctuatedWhSubjectClausePredicateHead,
  looksLikePluralNounInterrogativeSubjectHead,
  resolveNonPunctuatedWhExistentialClauseDeclarative,
  tokenLooksLikeNonPunctuatedWhClauseSubject,
} from './answerInterpretationNonPunctuatedQuestionCoreSupport'
import type { EmbeddedMatchingRunToken } from './answerInterpretationTypes'

type ParsedSentence = {
  text: string
}

interface QuestionDetectionSupportDependencies {
  inferCanonicalQuestionAnchorSummary: (question: string) => string | undefined
  normalizeEmbeddedQuestionAnchorText: (question: string) => string
  normalizeExplicitQuestionSurfaceText: (question: string) => string
  parseTopicSourceResponseSentences: (text: string) => ParsedSentence[]
  resolveCanonicalQuestionAnchorMatch: (
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    startTokenIndex: number,
  ) => { canonicalPrompt: string; endOriginal: number } | undefined
  stripLeadingPresentationListMarkers: (text: string) => string
  stripLeadingQuestionPromptConjunction: (question: string) => string
  tokenizeEmbeddedMatchingRunSourceResponse: (sourceResponse: string) => EmbeddedMatchingRunToken[]
}

export function createAnswerInterpretationQuestionDetectionSupport(
  dependencies: QuestionDetectionSupportDependencies,
) {
  function extractNonPunctuatedInterrogativeLeadingWord(text: string) {
    const match = /^[^a-z0-9]*(?<word>[a-z]+(?:['’][a-z]+)?)/iu.exec(text.trim())?.groups?.word
    return match?.toLowerCase().replaceAll('’', "'")
  }

  function findContextualBareInterrogativePredicateToken(
    tokens: EmbeddedMatchingRunToken[],
    startIndex: number,
  ) {
    for (let tokenIndex = startIndex; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex]?.normalizedText
      if (!token || NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(token)) {
        continue
      }
      return token
    }

    return undefined
  }

  function isLikelyBareDoQuestionPredicateToken(token: string | undefined) {
    return Boolean(
      token &&
        !CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(token) &&
        !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
        !token.endsWith('ing') &&
        !token.endsWith('ly') &&
        !token.endsWith('s'),
    )
  }

  function isLikelyBareHaveQuestionPredicateToken(token: string | undefined) {
    return Boolean(
      token &&
        !CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(token) &&
        !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(token) &&
        (/ed$/iu.test(token) ||
          /en$/iu.test(token) ||
          CONTEXTUAL_BARE_HAVE_PARTICIPLE_PREDICATE_WORDS.has(token)),
    )
  }

  function hasContextualBareInterrogativeSubject(
    tokens: EmbeddedMatchingRunToken[],
    leadingWord: string,
    secondToken: string | undefined,
  ) {
    if (leadingWord === 'need') {
      if (secondToken === 'there') {
        return true
      }

      if (
        secondToken &&
        CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(secondToken)
      ) {
        return true
      }

      const predicateToken = findContextualBareInterrogativePredicateToken(tokens, 2)
      return Boolean(
        secondToken &&
          predicateToken &&
          !NON_PUNCTUATED_INTERROGATIVE_AUXILIARY_TOKENS.has(secondToken) &&
          !NON_PUNCTUATED_INTERROGATIVE_NON_PREDICATE_WORDS.has(secondToken) &&
          !NON_PUNCTUATED_INTERROGATIVE_PREDICATE_FILLER_WORDS.has(secondToken) &&
          (tokenLooksLikeNonPunctuatedWhClauseSubject(secondToken) ||
            !looksLikeNonPunctuatedWhSubjectClausePredicateHead(secondToken)),
      )
    }

    if (leadingWord === 'have' && secondToken === 'there') {
      return true
    }

    if ((leadingWord === 'do' || leadingWord === "don't") && secondToken === 'there') {
      return true
    }

    if (secondToken && CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_SUBJECT_WORDS.has(secondToken)) {
      return true
    }

    if (leadingWord !== 'do' && leadingWord !== "don't" && leadingWord !== 'have') {
      return false
    }

    const maxSubjectHeadIndex = Math.min(tokens.length - 2, 3)
    for (let subjectHeadIndex = 1; subjectHeadIndex <= maxSubjectHeadIndex; subjectHeadIndex += 1) {
      const subjectHeadToken = tokens[subjectHeadIndex]?.normalizedText
      if (!subjectHeadToken || !looksLikePluralNounInterrogativeSubjectHead(subjectHeadToken)) {
        continue
      }

      const predicateToken = findContextualBareInterrogativePredicateToken(
        tokens,
        subjectHeadIndex + 1,
      )
      if (
        ((leadingWord === 'do' || leadingWord === "don't") &&
          isLikelyBareDoQuestionPredicateToken(predicateToken)) ||
        (leadingWord === 'have' && isLikelyBareHaveQuestionPredicateToken(predicateToken))
      ) {
        return true
      }
    }

    return false
  }

  function hasNonPunctuatedWhCommaContinuation(text: string) {
    const commaTail = /^[^,，]+[,，]\s*(?<tail>.+)$/u.exec(text.trim())?.groups?.tail?.trim()
    return Boolean(
      commaTail && dependencies.tokenizeEmbeddedMatchingRunSourceResponse(commaTail).length > 0
    )
  }

  function inferNonPunctuatedInterrogativeQuestionAuthority(sentence: string) {
    const strippedSentence = dependencies.stripLeadingQuestionPromptConjunction(sentence).trim()
    if (!strippedSentence || /[?？]/u.test(strippedSentence)) {
      return undefined
    }

    const withoutTerminalPunctuation = strippedSentence.replace(/[.!。！]+$/u, '').trim()
    if (!withoutTerminalPunctuation) {
      return undefined
    }

    const tokens =
      dependencies.tokenizeEmbeddedMatchingRunSourceResponse(withoutTerminalPunctuation)
    const leadingWord = extractNonPunctuatedInterrogativeLeadingWord(withoutTerminalPunctuation)
    const secondToken = tokens[1]?.normalizedText
    if (
      !leadingWord ||
      (!NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS.has(leadingWord) &&
        !CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS.has(leadingWord)) ||
      tokens.length < 3
    ) {
      return undefined
    }

    if (
      CONTEXTUAL_NON_PUNCTUATED_INTERROGATIVE_LEADING_WORDS.has(leadingWord) &&
      !hasContextualBareInterrogativeSubject(tokens, leadingWord, secondToken)
    ) {
      return undefined
    }

    const existentialStarterIndex = findNonPunctuatedWhClauseExistentialStarterIndex(tokens, 1)
    if (existentialStarterIndex !== undefined) {
      const existentialClauseDeclarative = resolveNonPunctuatedWhExistentialClauseDeclarative(
        tokens,
        existentialStarterIndex,
      )
      if (existentialClauseDeclarative === false) {
        return dependencies.normalizeExplicitQuestionSurfaceText(
          `${withoutTerminalPunctuation}?`,
        )
      }
      if (existentialClauseDeclarative === true) {
        if (
          isAuxiliaryLedExistentialPluralComplementQuestion(
            tokens,
            leadingWord,
            existentialStarterIndex,
          )
        ) {
          return dependencies.normalizeExplicitQuestionSurfaceText(
            `${withoutTerminalPunctuation}?`,
          )
        }
        if (
          isAdverbLedExistentialPluralComplementQuestion(
            tokens,
            leadingWord,
            existentialStarterIndex,
          )
        ) {
          return dependencies.normalizeExplicitQuestionSurfaceText(
            `${withoutTerminalPunctuation}?`,
          )
        }
        return undefined
      }
    }

    if (
      isNonPunctuatedWhClauseDeclarative(
        tokens,
        leadingWord,
        withoutTerminalPunctuation,
        hasNonPunctuatedWhCommaContinuation,
      )
    ) {
      return undefined
    }

    return dependencies.normalizeExplicitQuestionSurfaceText(`${withoutTerminalPunctuation}?`)
  }

  function startsWithNonPunctuatedWhClauseDeclarative(text: string) {
    const strippedText = dependencies.stripLeadingQuestionPromptConjunction(text).trim()
    if (!strippedText || /[?？]/u.test(strippedText)) {
      return false
    }

    const withoutTerminalPunctuation = strippedText.replace(/[.!。！]+$/u, '').trim()
    if (!withoutTerminalPunctuation) {
      return false
    }

    const tokens =
      dependencies.tokenizeEmbeddedMatchingRunSourceResponse(withoutTerminalPunctuation)
    const leadingWord = extractNonPunctuatedInterrogativeLeadingWord(withoutTerminalPunctuation)
    if (
      !leadingWord ||
      !NON_PUNCTUATED_INTERROGATIVE_WH_LEADING_WORDS.has(leadingWord) ||
      tokens.length < 3
    ) {
      return false
    }

    const existentialStarterIndex = findNonPunctuatedWhClauseExistentialStarterIndex(tokens, 1)
    if (existentialStarterIndex !== undefined) {
      const existentialClauseDeclarative = resolveNonPunctuatedWhExistentialClauseDeclarative(
        tokens,
        existentialStarterIndex,
      )
      if (existentialClauseDeclarative !== undefined) {
        if (
          existentialClauseDeclarative &&
          isAdverbLedExistentialPluralComplementQuestion(
            tokens,
            leadingWord,
            existentialStarterIndex,
          )
        ) {
          return false
        }
        return existentialClauseDeclarative
      }
    }

    return isNonPunctuatedWhClauseDeclarative(
      tokens,
      leadingWord,
      withoutTerminalPunctuation,
      hasNonPunctuatedWhCommaContinuation,
    )
  }

  function isQuestionSourceResponseText(text: string) {
    const trimmed = dependencies.stripLeadingQuestionPromptConjunction(text)
    return (
      /[?？]\s*$/u.test(trimmed) ||
      Boolean(dependencies.inferCanonicalQuestionAnchorSummary(trimmed)) ||
      Boolean(inferNonPunctuatedInterrogativeQuestionAuthority(trimmed))
    )
  }

  function normalizeQuestionSourceResponsePrompt(question: string) {
    const trimmed = dependencies.stripLeadingQuestionPromptConjunction(question)
    if (!trimmed || /[?？]\s*$/u.test(trimmed)) {
      return dependencies.normalizeExplicitQuestionSurfaceText(trimmed)
    }
    if (dependencies.inferCanonicalQuestionAnchorSummary(trimmed)) {
      return dependencies.normalizeEmbeddedQuestionAnchorText(trimmed)
    }
    const nonPunctuatedQuestionAuthority = inferNonPunctuatedInterrogativeQuestionAuthority(trimmed)
    if (nonPunctuatedQuestionAuthority) {
      return nonPunctuatedQuestionAuthority
    }
    return dependencies.normalizeEmbeddedQuestionAnchorText(trimmed)
  }

  function extractLeadingTextBeforeCanonicalQuestionAuthority(question: string) {
    const trimmed = question.trim()
    if (!trimmed) {
      return undefined
    }

    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(trimmed)
    for (let startTokenIndex = 0; startTokenIndex < tokens.length - 3; startTokenIndex += 1) {
      const match = dependencies.resolveCanonicalQuestionAnchorMatch(
        trimmed,
        tokens,
        startTokenIndex,
      )
      if (!match) {
        continue
      }

      const prefix = trimmed.slice(0, tokens[startTokenIndex]?.start ?? 0).trim()
      if (!prefix) {
        return undefined
      }

      const normalizedPrefix = dependencies
        .stripLeadingPresentationListMarkers(prefix)
        .replace(/^(?:and|but)\b[\s,;:.\-–—―]*/i, '')
        .trim()
      return normalizedPrefix || undefined
    }

    return undefined
  }

  function extractQuestionAuthorityTextsFromText(text: string) {
    const authorities: string[] = []

    for (const sentence of dependencies.parseTopicSourceResponseSentences(text)) {
      const strippedSentence = dependencies.stripLeadingQuestionPromptConjunction(sentence.text)
      const strippedTokens =
        dependencies.tokenizeEmbeddedMatchingRunSourceResponse(strippedSentence)
      const canonicalQuestionAuthorities: string[] = []
      for (
        let startTokenIndex = 0;
        startTokenIndex < strippedTokens.length - 3;
        startTokenIndex += 1
      ) {
        const match = dependencies.resolveCanonicalQuestionAnchorMatch(
          strippedSentence,
          strippedTokens,
          startTokenIndex,
        )
        if (match) {
          canonicalQuestionAuthorities.push(match.canonicalPrompt)
        }
      }

      if (canonicalQuestionAuthorities.length > 0) {
        authorities.push(...canonicalQuestionAuthorities)
        continue
      }

      const nonPunctuatedAuthority = inferNonPunctuatedInterrogativeQuestionAuthority(sentence.text)
      if (nonPunctuatedAuthority) {
        authorities.push(nonPunctuatedAuthority)
        continue
      }

      if (isQuestionSourceResponseText(sentence.text)) {
        const normalizedQuestion = dependencies.normalizeExplicitQuestionSurfaceText(
          dependencies.stripLeadingQuestionPromptConjunction(sentence.text),
        )
        if (normalizedQuestion) {
          authorities.push(normalizedQuestion)
        }
      }
    }

    return dedupeNonEmptyStrings(authorities)
  }

  return {
    extractLeadingTextBeforeCanonicalQuestionAuthority,
    extractQuestionAuthorityTextsFromText,
    hasNonPunctuatedWhCommaContinuation,
    inferNonPunctuatedInterrogativeQuestionAuthority,
    isQuestionSourceResponseText,
    normalizeQuestionSourceResponsePrompt,
    startsWithNonPunctuatedWhClauseDeclarative,
  }
}
