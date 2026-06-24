import { normalizeSourceResponseText } from './answerInterpretationStrings'
import type {
  TopicSourceResponseParagraph,
  TopicSourceResponseSentence,
} from './answerInterpretationTypes'

interface TextUnitSupportDependencies {
  sourceResponseStartsWithProtectedLeadingConjunctionSequence: (
    sourceResponse: string,
  ) => boolean
}

const LEADING_COMMON_ROMAN_OUTLINE_PAREN_MARKER_PATTERN =
  /^(?:(?:\([IVXivx]{2,8}\)|（[IVXivx]{2,8}）)\s*)+/u
const LEADING_COMMON_ROMAN_OUTLINE_MARKER_PATTERN = /^(?:(?:[IVX]{2,8}[.)])\s*)+/u
const STANDALONE_COMMON_ROMAN_OUTLINE_MARKER_PATTERN =
  /^(?:[IVX]{2,8}[.)]|\([IVXivx]{2,8}\)|（[IVXivx]{2,8}）)$/u
const LEADING_FULLWIDTH_NUMBER_PAREN_MARKER_PATTERN = /^(?:(?:\([０-９]+\)|（[０-９]+）)\s*)+/u
const LEADING_FULLWIDTH_NUMBER_MARKER_PATTERN = /^(?:(?:[０-９]+[．.)）])\s*)+/u
const LEADING_CIRCLED_NUMBER_MARKER_PATTERN = /^(?:[①-⑳]\s*)+/u
const LEADING_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN =
  /^(?:(?:\d+|[０-９]+|[一二三四五六七八九十百千]+)、\s*)+/u
const LEADING_CJK_NUMBER_PAREN_MARKER_PATTERN =
  /^(?:(?:\([一二三四五六七八九十百千]+\)|（[一二三四五六七八九十百千]+）)\s*)+/u
const STANDALONE_FULLWIDTH_NUMBER_MARKER_PATTERN =
  /^(?:[０-９]+[．.)）]|\([０-９]+\)|（[０-９]+）|[①-⑳])$/u
const STANDALONE_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN =
  /^(?:\d+、|[０-９]+、|[一二三四五六七八九十百千]+、|\([一二三四五六七八九十百千]+\)|（[一二三四五六七八九十百千]+）)$/u

export function createAnswerInterpretationTextUnitSupport(
  dependencies: TextUnitSupportDependencies,
) {
  function stripLeadingPresentationListMarkers(text: string) {
    let stripped = text.trim()
    while (stripped) {
      const next = stripped
        .replace(/^(?:#{1,6}\s+)+/u, '')
        .replace(/^(?:>\s*)+/u, '')
        .replace(/^(?:[-*]\s*\[(?: |x|X)\]\s*)+/u, '')
        .replace(/^(?:\[(?: |x|X)\]\s*)+/u, '')
        .replace(LEADING_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN, '')
        .replace(LEADING_CJK_NUMBER_PAREN_MARKER_PATTERN, '')
        .replace(LEADING_FULLWIDTH_NUMBER_PAREN_MARKER_PATTERN, '')
        .replace(LEADING_FULLWIDTH_NUMBER_MARKER_PATTERN, '')
        .replace(LEADING_CIRCLED_NUMBER_MARKER_PATTERN, '')
        .replace(/^(?:(?:\(\d+\)|（\d+）|\([A-Za-z]\)|（[A-Za-z]）)\s*)+/u, '')
        .replace(LEADING_COMMON_ROMAN_OUTLINE_PAREN_MARKER_PATTERN, '')
        .replace(LEADING_COMMON_ROMAN_OUTLINE_MARKER_PATTERN, '')
        .replace(/^(?:(?:\d+[.)]|[A-Za-z][.)])\s*)+/u, '')
        .replace(/^(?:[-+*•・●→○◦▪◆■□▸▹►▻▶▷⁃‣–—―]\s*)+/u, '')
        .trim()
      if (next === stripped) {
        return stripped
      }
      stripped = next
    }
    return stripped
  }

  function stripTrailingPresentationListMarkers(text: string) {
    let stripped = text.trim()
    while (stripped) {
      let removed = false
      for (let index = stripped.length - 1; index >= 0; index -= 1) {
        const previousCharacter = stripped[index - 1]
        if (index > 0 && previousCharacter && !/[\s,;:([{]/u.test(previousCharacter)) {
          continue
        }

        const suffix = stripped.slice(index).trim()
        if (!suffix) {
          continue
        }
        if (stripLeadingPresentationListMarkers(suffix) !== '') {
          continue
        }

        stripped = stripped.slice(0, index).trimEnd()
        removed = true
        break
      }

      if (!removed) {
        return stripped
      }
    }

    return stripped
  }

  function stripStandalonePresentationListMarkerTokens(text: string) {
    return text
      .split(/\s+/)
      .filter((token) => token && !isStandalonePresentationListMarker(token))
      .join(' ')
  }

  function isStandalonePresentationListMarker(text: string) {
    const trimmed = text.trim()
    return (
      /^(?:#{1,6}|[-+*•・●→○◦▪◆■□▸▹►▻▶▷⁃‣–—―]|>+|\d+[.)]|[A-Za-z][.)]|\(\d+\)|（\d+）|\([A-Za-z]\)|（[A-Za-z]）|\[(?: |x|X)\])$/u.test(
        trimmed,
      ) ||
      STANDALONE_COMMON_ROMAN_OUTLINE_MARKER_PATTERN.test(trimmed) ||
      STANDALONE_FULLWIDTH_NUMBER_MARKER_PATTERN.test(trimmed) ||
      STANDALONE_IDEOGRAPHIC_COMMA_NUMBER_MARKER_PATTERN.test(trimmed)
    )
  }

  function normalizeExplicitTopicOrQuestionUnitText(text: string) {
    return stripLeadingPresentationListMarkers(text.trim())
  }

  function parseTopicSourceResponseSentences(sourceResponse: string) {
    return sourceResponse
      .split(/(?:\r?\n+|;+\s*|；+\s*|(?<=[.?!。？！])\s+)/)
      .map((sentence) => normalizeExplicitTopicOrQuestionUnitText(sentence))
      .filter((sentence) => sentence.length > 0 && !isStandalonePresentationListMarker(sentence))
      .map(
        (sentence): TopicSourceResponseSentence => ({
          text: sentence,
          normalizedText: normalizeSourceResponseText(sentence),
        }),
      )
  }

  function parseTopicSourceResponseClauses(sourceResponse: string) {
    return sourceResponse
      .split(/(?:\r?\n+|,+\s*|，+\s*|;+\s*|；+\s*|(?<=[.?!。？！])\s+)/)
      .map((clause) => normalizeExplicitTopicOrQuestionUnitText(clause))
      .filter((clause) => clause.length > 0 && !isStandalonePresentationListMarker(clause))
      .map(
        (clause): TopicSourceResponseSentence => ({
          text: clause,
          normalizedText: normalizeSourceResponseText(clause),
        }),
      )
  }

  function parseTopicSourceResponseParagraphs(sourceResponse: string) {
    return sourceResponse
      .split(/\r?\n\s*\r?\n+/)
      .map((paragraph) => normalizeExplicitTopicOrQuestionUnitText(paragraph))
      .filter((paragraph) => paragraph.length > 0 && !isStandalonePresentationListMarker(paragraph))
      .map(
        (paragraph): TopicSourceResponseParagraph => ({
          text: paragraph,
          normalizedText: normalizeSourceResponseText(paragraph),
        }),
      )
  }

  function normalizeGenericPendingOrMatchingUnitText(text: string) {
    return stripLeadingPresentationListMarkers(text.trim())
  }

  function parseGenericPendingSourceResponseClauses(sourceResponse: string) {
    return parseTopicSourceResponseClauses(sourceResponse)
      .map((clause) => normalizeGenericPendingOrMatchingUnitText(clause.text))
      .filter(Boolean)
  }

  function parseGenericPendingSourceResponseParagraphs(sourceResponse: string) {
    return parseTopicSourceResponseParagraphs(sourceResponse)
      .map((paragraph) => normalizeGenericPendingOrMatchingUnitText(paragraph.text))
      .filter(Boolean)
  }

  function parseGenericPendingSourceResponseSentences(sourceResponse: string) {
    return parseTopicSourceResponseSentences(sourceResponse)
      .map((sentence) => normalizeGenericPendingOrMatchingUnitText(sentence.text))
      .filter(Boolean)
  }

  function parsePendingSourceResponseConjunctions(sourceResponse: string) {
    const normalizedSourceResponse = normalizeGenericPendingOrMatchingUnitText(sourceResponse)
    if (!normalizedSourceResponse) {
      return []
    }

    if (
      dependencies.sourceResponseStartsWithProtectedLeadingConjunctionSequence(
        normalizedSourceResponse,
      )
    ) {
      return [normalizedSourceResponse]
    }

    return normalizedSourceResponse
      .split(/\s+(?:and then|then|and)\s+/i)
      .map((segment) => normalizeGenericPendingOrMatchingUnitText(segment))
      .filter(Boolean)
  }

  return {
    isStandalonePresentationListMarker,
    normalizeExplicitTopicOrQuestionUnitText,
    normalizeGenericPendingOrMatchingUnitText,
    parseGenericPendingSourceResponseClauses,
    parseGenericPendingSourceResponseParagraphs,
    parseGenericPendingSourceResponseSentences,
    parsePendingSourceResponseConjunctions,
    parseTopicSourceResponseClauses,
    parseTopicSourceResponseParagraphs,
    parseTopicSourceResponseSentences,
    stripLeadingPresentationListMarkers,
    stripStandalonePresentationListMarkerTokens,
    stripTrailingPresentationListMarkers,
  }
}
