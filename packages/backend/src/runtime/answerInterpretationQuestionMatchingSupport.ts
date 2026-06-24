import { AnswerInterpretationError } from './answerInterpretationErrors'
import { normalizeSourceResponseText } from './answerInterpretationStrings'

interface QuestionMatchingSupportDependencies {
  stripLeadingPresentationListMarkers: (text: string) => string
}

export const QUESTION_CORE_LEADING_TOKENS = new Set([
  'a',
  'an',
  'are',
  'be',
  'can',
  'could',
  'did',
  'do',
  'does',
  'for',
  'had',
  'has',
  'have',
  'how',
  'is',
  'need',
  'needed',
  'needs',
  'our',
  'should',
  'the',
  'to',
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
  'would',
])

const QUESTION_KEYWORD_STOPWORDS = new Set([
  ...QUESTION_CORE_LEADING_TOKENS,
  'all',
  'and',
  'as',
  'at',
  'by',
  'if',
  'in',
  'into',
  'it',
  'its',
  'of',
  'on',
  'or',
  'than',
  'then',
  'through',
  'via',
  'with',
])

export function createAnswerInterpretationQuestionMatchingSupport(
  dependencies: QuestionMatchingSupportDependencies,
) {
  function stripLeadingQuestionPromptConjunction(question: string) {
    return dependencies.stripLeadingPresentationListMarkers(
      question.trim().replace(/^(?:and|but)\s+/i, ''),
    )
  }

  function normalizeExplicitQuestionSurfaceText(question: string) {
    if (!question) {
      return question
    }

    return `${question.slice(0, 1).toUpperCase()}${question.slice(1)}`
  }

  function normalizeQuestionPromptCore(value: string) {
    const normalized = normalizeSourceResponseText(value)
    if (!normalized) {
      return ''
    }

    const tokens = normalized.split(' ').filter(Boolean)
    let startIndex = 0
    while (
      startIndex < tokens.length &&
      QUESTION_CORE_LEADING_TOKENS.has(tokens[startIndex] ?? '')
    ) {
      startIndex += 1
    }

    return tokens.slice(startIndex).join(' ')
  }

  function extractQuestionPromptKeywordAnchors(normalizedText: string) {
    const anchors = new Set<string>()
    for (const token of normalizedText.split(' ')) {
      if (!token || QUESTION_KEYWORD_STOPWORDS.has(token)) {
        continue
      }
      anchors.add(token)
    }
    return [...anchors]
  }

  function keywordAnchorSetsMatch(normalizedQuestionText: string, normalizedCandidate: string) {
    const questionAnchors = extractQuestionPromptKeywordAnchors(normalizedQuestionText)
    const candidateAnchors = extractQuestionPromptKeywordAnchors(normalizedCandidate)
    if (questionAnchors.length < 2 || candidateAnchors.length < 2) {
      return false
    }

    const questionAnchorSet = new Set(questionAnchors)
    const candidateAnchorSet = new Set(candidateAnchors)
    return (
      questionAnchors.every((anchor) => candidateAnchorSet.has(anchor)) ||
      candidateAnchors.every((anchor) => questionAnchorSet.has(anchor))
    )
  }

  function questionTextMatchesCandidate(
    normalizedQuestionText: string,
    normalizedQuestionCoreText: string,
    normalizedCandidate: string,
    normalizedCandidateCore: string,
  ) {
    if (` ${normalizedQuestionText} `.includes(` ${normalizedCandidate} `)) {
      return true
    }
    if (!normalizedQuestionCoreText || !normalizedCandidateCore) {
      return false
    }
    if (normalizedQuestionCoreText === normalizedCandidateCore) {
      return true
    }
    return (
      ` ${normalizedQuestionCoreText} `.includes(` ${normalizedCandidateCore} `) ||
      ` ${normalizedCandidateCore} `.includes(` ${normalizedQuestionCoreText} `) ||
      keywordAnchorSetsMatch(normalizedQuestionText, normalizedCandidate)
    )
  }

  function topicTextMatchesCandidate(
    normalizedText: string,
    normalizedCandidate: string,
    normalizedCandidateCore: string,
  ) {
    if (` ${normalizedText} `.includes(` ${normalizedCandidate} `)) {
      return true
    }
    if (normalizedCandidateCore && ` ${normalizedText} `.includes(` ${normalizedCandidateCore} `)) {
      return true
    }
    return keywordAnchorSetsMatch(normalizedText, normalizedCandidate)
  }

  function resolveSingleTopicAnchorLabel(
    text: string,
    matchingLabels: string[],
    multipleMatchMessage: string,
    inferLabels: (text: string) => string[],
  ) {
    if (matchingLabels.length > 1) {
      throw new AnswerInterpretationError(multipleMatchMessage)
    }

    const inferredLabels = [...new Set(inferLabels(text).filter(Boolean))]
    if (inferredLabels.length > 1) {
      throw new AnswerInterpretationError(multipleMatchMessage)
    }

    return matchingLabels[0] ?? inferredLabels[0]
  }

  return {
    normalizeExplicitQuestionSurfaceText,
    normalizeQuestionPromptCore,
    questionTextMatchesCandidate,
    resolveSingleTopicAnchorLabel,
    stripLeadingQuestionPromptConjunction,
    topicTextMatchesCandidate,
  }
}
