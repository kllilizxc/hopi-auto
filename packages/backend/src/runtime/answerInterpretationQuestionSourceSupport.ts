import { AnswerInterpretationError } from './answerInterpretationErrors'
import { normalizeSourceResponseText } from './answerInterpretationStrings'
import type {
  EmbeddedMatchingRunAnchor,
  EmbeddedMatchingRunToken,
  InterpretedSourceResponseState,
  QuestionSourceResponseBlock,
  QuestionSourceResponseClosingBlock,
  QuestionSourceResponseClosingSpan,
  QuestionSourceResponseSpan,
} from './answerInterpretationTypes'

type ParsedUnit = {
  text: string
}

interface QuestionSourceSupportDependencies {
  assertQuestionAnswerTopicAuthorityMatchesQuestion: (
    question: string,
    answer: string,
    unitLabel: string,
  ) => void
  inferCanonicalQuestionAnchorSummary: (question: string) => string | undefined
  inferNonPunctuatedInterrogativeQuestionAuthority: (sentence: string) => string | undefined
  normalizeEmbeddedMatchingRunText: (text: string) => string
  normalizeEmbeddedQuestionAnchorText: (question: string) => string
  normalizeExplicitQuestionSurfaceText: (question: string) => string
  normalizeExplicitTopicOrQuestionUnitText: (text: string) => string
  normalizeQuestionPromptCore: (value: string) => string
  parseTopicSourceResponseParagraphs: (sourceResponse: string) => ParsedUnit[]
  parseTopicSourceResponseSentences: (sourceResponse: string) => ParsedUnit[]
  resolveCanonicalQuestionAnchorMatch: (
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    startTokenIndex: number,
  ) => { canonicalPrompt: string; endOriginal: number } | undefined
  resolveEmbeddedQuestionAnchorsWithInferredCandidates: (
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    candidateGroups: string[][],
    sourceResponseFormat: 'question_spans' | 'question_middle_spans' | 'question_closing_spans',
  ) => EmbeddedMatchingRunAnchor[]
  stripLeadingQuestionPromptConjunction: (question: string) => string
  tokenizeEmbeddedMatchingRunSourceResponse: (sourceResponse: string) => EmbeddedMatchingRunToken[]
  isStandalonePresentationListMarker: (text: string) => boolean
}

const QUESTION_CLAUSE_INNER_CANONICAL_ANCHOR_PRECEDING_TOKENS = new Set(['and', 'but'])

export function createAnswerInterpretationQuestionSourceSupport(
  dependencies: QuestionSourceSupportDependencies,
) {
  function createQuestionResponseEntry(
    question: string,
    answer: string,
  ): Omit<QuestionSourceResponseSpan, 'question'> & { question: string } {
    return {
      question,
      normalizedQuestionText: normalizeSourceResponseText(question),
      normalizedQuestionCoreText: dependencies.normalizeQuestionPromptCore(question),
      answer,
    }
  }

  function requireSourceResponse(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseFormat:
      | 'question_blocks'
      | 'question_clauses'
      | 'question_spans'
      | 'question_middle_spans'
      | 'question_closing_spans'
      | 'question_closing_blocks'
      | 'question_middle_blocks',
  ) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} requires sourceResponse for ${label}.`,
      )
    }
    return shared
  }

  function parseRequiredQuestionSourceResponseBlocks(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.questionBlocks) {
      return sourceResponseState.questionBlocks
    }

    const blocks = parseQuestionSourceResponseBlocks(
      requireSourceResponse(sourceResponse, label, 'question_blocks'),
    )
    if (sourceResponseState) {
      sourceResponseState.questionBlocks = blocks
    }
    return blocks
  }

  function parseRequiredQuestionSourceResponseClauses(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.questionClauses) {
      return sourceResponseState.questionClauses
    }

    const clauses = parseQuestionSourceResponseClauses(
      requireSourceResponse(sourceResponse, label, 'question_clauses'),
    )
    if (sourceResponseState) {
      sourceResponseState.questionClauses = clauses
    }
    return clauses
  }

  function parseRequiredQuestionSourceResponseSpans(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.questionSpans) {
      return sourceResponseState.questionSpans
    }

    const shared = requireSourceResponse(sourceResponse, label, 'question_spans')
    if (dependencies.parseTopicSourceResponseSentences(shared).length === 1) {
      const embeddedSpans = parseEmbeddedQuestionSourceResponseSpans(
        shared,
        sourceResponseState?.questionAnchorCandidateGroups ?? [],
      )
      if (embeddedSpans) {
        if (sourceResponseState) {
          sourceResponseState.questionSpans = embeddedSpans
        }
        return embeddedSpans
      }
    }

    const spans = parseQuestionSourceResponseSpans(shared)
    if (sourceResponseState) {
      sourceResponseState.questionSpans = spans
    }
    return spans
  }

  function parseEmbeddedQuestionSourceResponseSpans(
    sourceResponse: string,
    candidateGroups: string[][],
  ) {
    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
    if (tokens.length === 0) {
      return undefined
    }

    const anchors = dependencies.resolveEmbeddedQuestionAnchorsWithInferredCandidates(
      sourceResponse,
      tokens,
      candidateGroups,
      'question_spans',
    )
    if (anchors.length === 0) {
      return undefined
    }

    if (anchors[0]?.startTokenIndex !== 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_spans requires sourceResponse to start with a matched question anchor.',
      )
    }

    const spans: QuestionSourceResponseSpan[] = []
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] as EmbeddedMatchingRunAnchor
      const nextAnchor = anchors[index + 1]
      if (nextAnchor) {
        if (nextAnchor.startTokenIndex === anchor.endTokenIndex) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat question_spans requires each embedded question anchor to include answer text before the next matched question anchor.',
          )
        }
      } else if (anchor.endTokenIndex >= tokens.length) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_spans requires each embedded question anchor to include answer text after the matched question anchor.',
        )
      }

      const question = dependencies.normalizeEmbeddedQuestionAnchorText(
        sourceResponse.slice(anchor.startOriginal, anchor.endOriginal).trim(),
      )
      const answer = dependencies.normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(anchor.endOriginal, nextAnchor?.startOriginal ?? sourceResponse.length),
      )
      dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
        question,
        answer,
        'Question span',
      )
      spans.push(createQuestionResponseEntry(question, answer))
    }

    return spans
  }

  function parseRequiredQuestionSourceResponseMiddleSpans(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.questionMiddleSpans) {
      return sourceResponseState.questionMiddleSpans
    }

    const shared = requireSourceResponse(sourceResponse, label, 'question_middle_spans')
    if (dependencies.parseTopicSourceResponseSentences(shared).length === 1) {
      const embeddedSpans = parseEmbeddedQuestionSourceResponseMiddleSpans(
        shared,
        sourceResponseState?.questionAnchorCandidateGroups ?? [],
      )
      if (embeddedSpans) {
        if (sourceResponseState) {
          sourceResponseState.questionMiddleSpans = embeddedSpans
        }
        return embeddedSpans
      }
    }

    const spans = parseQuestionSourceResponseMiddleSpans(shared)
    if (sourceResponseState) {
      sourceResponseState.questionMiddleSpans = spans
    }
    return spans
  }

  function parseEmbeddedQuestionSourceResponseMiddleSpans(
    sourceResponse: string,
    candidateGroups: string[][],
  ) {
    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
    if (tokens.length === 0) {
      return undefined
    }

    const anchors = dependencies.resolveEmbeddedQuestionAnchorsWithInferredCandidates(
      sourceResponse,
      tokens,
      candidateGroups,
      'question_middle_spans',
    )
    if (anchors.length === 0) {
      return undefined
    }

    if (anchors[0]?.startTokenIndex === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_spans requires each span to start with at least one leading sentence before the question sentence.',
      )
    }

    const spans: QuestionSourceResponseSpan[] = []
    let currentSpanStartOriginal = 0

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] as EmbeddedMatchingRunAnchor
      const nextAnchor = anchors[index + 1]
      const trailingTokenCount = tokens.length - anchor.endTokenIndex

      const question = dependencies.normalizeEmbeddedQuestionAnchorText(
        sourceResponse.slice(anchor.startOriginal, anchor.endOriginal).trim(),
      )
      const leadingAnswer = dependencies.normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(currentSpanStartOriginal, anchor.startOriginal),
      )

      if (index === anchors.length - 1) {
        if (trailingTokenCount === 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat question_middle_spans requires each span to end with at least one trailing sentence after the question sentence.',
          )
        }

        const trailingAnswer = dependencies.normalizeEmbeddedMatchingRunText(
          sourceResponse.slice(anchor.endOriginal),
        )
        const answer = [leadingAnswer, trailingAnswer].filter(Boolean).join(' ')
        dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
          question,
          answer,
          'Question middle span',
        )
        spans.push(createQuestionResponseEntry(question, answer))
        break
      }

      if (!nextAnchor) {
        break
      }

      const gapTokenCount = nextAnchor.startTokenIndex - anchor.endTokenIndex
      if (gapTokenCount < 2) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_middle_spans requires at least one trailing sentence before the next question sentence and at least one leading sentence for that next span.',
        )
      }

      const nextSpanLeadingTokenStartOriginal =
        tokens[nextAnchor.startTokenIndex - 1]?.start ?? sourceResponse.length
      const trailingAnswer = dependencies.normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(anchor.endOriginal, nextSpanLeadingTokenStartOriginal),
      )
      const answer = [leadingAnswer, trailingAnswer].filter(Boolean).join(' ')
      dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
        question,
        answer,
        'Question middle span',
      )
      spans.push(createQuestionResponseEntry(question, answer))
      currentSpanStartOriginal = nextSpanLeadingTokenStartOriginal
    }

    return spans
  }

  function parseRequiredQuestionSourceResponseClosingSpans(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.questionClosingSpans) {
      return sourceResponseState.questionClosingSpans
    }

    const shared = requireSourceResponse(sourceResponse, label, 'question_closing_spans')
    if (dependencies.parseTopicSourceResponseSentences(shared).length === 1) {
      const embeddedSpans = parseEmbeddedQuestionSourceResponseClosingSpans(
        shared,
        sourceResponseState?.questionAnchorCandidateGroups ?? [],
      )
      if (embeddedSpans) {
        if (sourceResponseState) {
          sourceResponseState.questionClosingSpans = embeddedSpans
        }
        return embeddedSpans
      }
    }

    const spans = parseQuestionSourceResponseClosingSpans(shared)
    if (sourceResponseState) {
      sourceResponseState.questionClosingSpans = spans
    }
    return spans
  }

  function parseEmbeddedQuestionSourceResponseClosingSpans(
    sourceResponse: string,
    candidateGroups: string[][],
  ) {
    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
    if (tokens.length === 0) {
      return undefined
    }

    const anchors = dependencies.resolveEmbeddedQuestionAnchorsWithInferredCandidates(
      sourceResponse,
      tokens,
      candidateGroups,
      'question_closing_spans',
    )
    if (anchors.length === 0) {
      return undefined
    }

    if (anchors[0]?.startTokenIndex === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_closing_spans requires each span to include at least one leading sentence before the question sentence.',
      )
    }

    const spans: QuestionSourceResponseClosingSpan[] = []
    let previousEndTokenIndex = 0
    let previousEndOriginal = 0

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] as EmbeddedMatchingRunAnchor

      if (index > 0 && anchor.startTokenIndex === previousEndTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_closing_spans requires at least one leading sentence before the next question sentence.',
        )
      }

      const hasTrailingTokens = anchor.endTokenIndex < tokens.length
      if (index === anchors.length - 1 && hasTrailingTokens) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_closing_spans requires each span to end with a question sentence.',
        )
      }

      const question = dependencies.normalizeEmbeddedQuestionAnchorText(
        sourceResponse.slice(anchor.startOriginal, anchor.endOriginal).trim(),
      )
      const answer = dependencies.normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(previousEndOriginal, anchor.startOriginal),
      )
      dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
        question,
        answer,
        'Question closing span',
      )
      spans.push(createQuestionResponseEntry(question, answer))
      previousEndTokenIndex = anchor.endTokenIndex
      previousEndOriginal = tokens[anchor.endTokenIndex]?.start ?? sourceResponse.length
    }

    return spans
  }

  function parseRequiredQuestionSourceResponseClosingBlocks(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.questionClosingBlocks) {
      return sourceResponseState.questionClosingBlocks
    }

    const blocks = parseQuestionSourceResponseClosingBlocks(
      requireSourceResponse(sourceResponse, label, 'question_closing_blocks'),
    )
    if (sourceResponseState) {
      sourceResponseState.questionClosingBlocks = blocks
    }
    return blocks
  }

  function parseRequiredQuestionSourceResponseMiddleBlocks(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.questionMiddleBlocks) {
      return sourceResponseState.questionMiddleBlocks
    }

    const blocks = parseQuestionSourceResponseMiddleBlocks(
      requireSourceResponse(sourceResponse, label, 'question_middle_blocks'),
    )
    if (sourceResponseState) {
      sourceResponseState.questionMiddleBlocks = blocks
    }
    return blocks
  }

  function parseQuestionSourceResponseBlocks(sourceResponse: string) {
    const paragraphs = sourceResponse
      .split(/\r?\n\s*\r?\n+/)
      .map((paragraph) => dependencies.normalizeExplicitTopicOrQuestionUnitText(paragraph))
      .filter(Boolean)
    const blocks: QuestionSourceResponseBlock[] = []
    let currentQuestion: string | undefined
    let answerParagraphs: string[] = []

    for (const paragraph of paragraphs) {
      if (isQuestionSourceResponseParagraph(paragraph)) {
        const questionParagraph = normalizeQuestionSourceResponsePrompt(paragraph)
        if (currentQuestion) {
          if (answerParagraphs.length === 0) {
            throw new AnswerInterpretationError(
              `Question block "${currentQuestion}" in sourceResponse did not include an answer block.`,
            )
          }
          const answer = answerParagraphs.join('\n\n')
          dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
            currentQuestion,
            answer,
            'Question block',
          )
          blocks.push(createQuestionResponseEntry(currentQuestion, answer))
        } else if (answerParagraphs.length > 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat question_blocks requires sourceResponse to start with a question block.',
          )
        }
        currentQuestion = questionParagraph
        answerParagraphs = []
        continue
      }

      if (!currentQuestion) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_blocks requires sourceResponse to start with a question block.',
        )
      }
      answerParagraphs.push(paragraph)
    }

    if (!currentQuestion) {
      return blocks
    }
    if (answerParagraphs.length === 0) {
      throw new AnswerInterpretationError(
        `Question block "${currentQuestion}" in sourceResponse did not include an answer block.`,
      )
    }
    const finalBlockAnswer = answerParagraphs.join('\n\n')
    dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
      currentQuestion,
      finalBlockAnswer,
      'Question block',
    )
    blocks.push(createQuestionResponseEntry(currentQuestion, finalBlockAnswer))
    return blocks
  }

  function parseQuestionSourceResponseClauses(sourceResponse: string) {
    const clauses = sourceResponse
      .split(/(?:\r?\n+|,+\s*|，+\s*|;+\s*|；+\s*)/)
      .map((clause) => clause.trim())
      .filter(
        (sentence) =>
          sentence.length > 0 && !dependencies.isStandalonePresentationListMarker(sentence),
      )
    const parsedClauses: QuestionSourceResponseSpan[] = []

    for (const clause of clauses) {
      const normalizedClause = dependencies.stripLeadingQuestionPromptConjunction(clause)
      const match = /^(?<question>.+?[?？])\s*(?<answer>.*)$/u.exec(normalizedClause)?.groups
      const canonicalQuestionAnchor = match?.question
        ? undefined
        : dependencies.resolveCanonicalQuestionAnchorMatch(
            normalizedClause,
            dependencies.tokenizeEmbeddedMatchingRunSourceResponse(normalizedClause),
            0,
          )
      const clauseSentences = dependencies.parseTopicSourceResponseSentences(normalizedClause)
      const question = match?.question
        ? normalizeQuestionSourceResponsePrompt(match.question)
        : (canonicalQuestionAnchor?.canonicalPrompt ??
          (clauseSentences[0] && isQuestionSourceResponseSentence(clauseSentences[0].text)
            ? normalizeQuestionSourceResponsePrompt(clauseSentences[0].text)
            : undefined))
      if (!question) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_clauses requires each clause to contain one question sentence followed by answer text.',
        )
      }

      const answer = dependencies.normalizeExplicitTopicOrQuestionUnitText(
        match?.answer?.trim() ??
          (canonicalQuestionAnchor
            ? normalizedClause.slice(canonicalQuestionAnchor.endOriginal).trim()
            : clauseSentences.length > 1
              ? clauseSentences
                  .slice(1)
                  .map((sentence) => sentence.text)
                  .join(' ')
              : ''
          ).trim(),
      )
      if (!answer) {
        throw new AnswerInterpretationError(
          `Question clause "${question}" in sourceResponse did not include answer text.`,
        )
      }
      if (questionClauseAnswerContainsAdditionalQuestionAnchor(answer)) {
        throw new AnswerInterpretationError(
          `Question clause "${question}" in sourceResponse included another question anchor inside answer text.`,
        )
      }
      dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
        question,
        answer,
        'Question clause',
      )

      parsedClauses.push(createQuestionResponseEntry(question, answer))
    }

    return parsedClauses
  }

  function questionClauseAnswerContainsAdditionalQuestionAnchor(answer: string) {
    for (const sentence of dependencies.parseTopicSourceResponseSentences(answer)) {
      if (isQuestionSourceResponseSentence(sentence.text)) {
        return true
      }

      const strippedSentence = dependencies.stripLeadingQuestionPromptConjunction(sentence.text)
      const strippedTokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(strippedSentence)
      if (dependencies.resolveCanonicalQuestionAnchorMatch(strippedSentence, strippedTokens, 0)) {
        return true
      }

      const sentenceTokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(sentence.text)
      for (
        let startTokenIndex = 1;
        startTokenIndex < sentenceTokens.length - 3;
        startTokenIndex += 1
      ) {
        const previousToken = sentenceTokens[startTokenIndex - 1]?.normalizedText
        if (!QUESTION_CLAUSE_INNER_CANONICAL_ANCHOR_PRECEDING_TOKENS.has(previousToken ?? '')) {
          continue
        }
        if (
          dependencies.resolveCanonicalQuestionAnchorMatch(
            sentence.text,
            sentenceTokens,
            startTokenIndex,
          )
        ) {
          return true
        }
      }
    }

    return false
  }

  function parseQuestionSourceResponseSpans(sourceResponse: string) {
    const sentences = dependencies.parseTopicSourceResponseSentences(sourceResponse)
    const spans: QuestionSourceResponseSpan[] = []
    let currentQuestion: string | undefined
    let answerSentences: string[] = []

    for (const sentence of sentences) {
      if (isQuestionSourceResponseSentence(sentence.text)) {
        const questionSentence = normalizeQuestionSourceResponsePrompt(sentence.text)
        if (currentQuestion) {
          if (answerSentences.length === 0) {
            throw new AnswerInterpretationError(
              `Question span "${currentQuestion}" in sourceResponse did not include an answer sentence.`,
            )
          }
          const answer = answerSentences.join(' ')
          dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
            currentQuestion,
            answer,
            'Question span',
          )
          spans.push(createQuestionResponseEntry(currentQuestion, answer))
        } else if (answerSentences.length > 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat question_spans requires sourceResponse to start with a question sentence.',
          )
        }
        currentQuestion = questionSentence
        answerSentences = []
        continue
      }

      if (!currentQuestion) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_spans requires sourceResponse to start with a question sentence.',
        )
      }
      answerSentences.push(sentence.text)
    }

    if (!currentQuestion) {
      return spans
    }
    if (answerSentences.length === 0) {
      throw new AnswerInterpretationError(
        `Question span "${currentQuestion}" in sourceResponse did not include an answer sentence.`,
      )
    }
    const finalSpanAnswer = answerSentences.join(' ')
    dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
      currentQuestion,
      finalSpanAnswer,
      'Question span',
    )
    spans.push(createQuestionResponseEntry(currentQuestion, finalSpanAnswer))
    return spans
  }

  function parseQuestionSourceResponseMiddleSpans(sourceResponse: string) {
    const sentences = dependencies.parseTopicSourceResponseSentences(sourceResponse)
    const spans: QuestionSourceResponseSpan[] = []
    let currentLeadingSentences: string[] = []
    let currentQuestion: string | undefined
    let trailingSentences: string[] = []

    for (const sentence of sentences) {
      if (!isQuestionSourceResponseSentence(sentence.text)) {
        if (!currentQuestion) {
          currentLeadingSentences.push(sentence.text)
        } else {
          trailingSentences.push(sentence.text)
        }
        continue
      }

      if (!currentQuestion) {
        if (currentLeadingSentences.length === 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat question_middle_spans requires each span to start with at least one leading sentence before the question sentence.',
          )
        }
        currentQuestion = normalizeQuestionSourceResponsePrompt(sentence.text)
        trailingSentences = []
        continue
      }

      if (trailingSentences.length < 2) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_middle_spans requires at least one trailing sentence before the next question sentence and at least one leading sentence for that next span.',
        )
      }
      const answer = [...currentLeadingSentences, ...trailingSentences.slice(0, -1)].join(' ')
      dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
        currentQuestion,
        answer,
        'Question middle span',
      )

      spans.push(createQuestionResponseEntry(currentQuestion, answer))
      currentLeadingSentences = [trailingSentences[trailingSentences.length - 1] as string]
      currentQuestion = normalizeQuestionSourceResponsePrompt(sentence.text)
      trailingSentences = []
    }

    if (!currentQuestion) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_spans requires at least one question anchor sentence with leading and trailing answer sentences.',
      )
    }
    if (trailingSentences.length === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_spans requires each span to end with at least one trailing sentence after the question sentence.',
      )
    }
    const finalMiddleSpanAnswer = [...currentLeadingSentences, ...trailingSentences].join(' ')
    dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
      currentQuestion,
      finalMiddleSpanAnswer,
      'Question middle span',
    )
    spans.push(createQuestionResponseEntry(currentQuestion, finalMiddleSpanAnswer))
    return spans
  }

  function parseQuestionSourceResponseClosingSpans(sourceResponse: string) {
    const sentences = dependencies.parseTopicSourceResponseSentences(sourceResponse)
    const spans: QuestionSourceResponseClosingSpan[] = []
    let pendingAnswerSentences: string[] = []

    for (const sentence of sentences) {
      if (!isQuestionSourceResponseSentence(sentence.text)) {
        pendingAnswerSentences.push(sentence.text)
        continue
      }

      const questionSentence = normalizeQuestionSourceResponsePrompt(sentence.text)

      if (pendingAnswerSentences.length === 0) {
        throw new AnswerInterpretationError(
          `Question closing span "${questionSentence}" in sourceResponse did not include an answer sentence.`,
        )
      }
      const answer = pendingAnswerSentences.join(' ')
      dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
        questionSentence,
        answer,
        'Question closing span',
      )

      spans.push(createQuestionResponseEntry(questionSentence, answer))
      pendingAnswerSentences = []
    }

    if (pendingAnswerSentences.length > 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_closing_spans requires each span to end with a question sentence.',
      )
    }

    return spans
  }

  function parseQuestionSourceResponseClosingBlocks(sourceResponse: string) {
    const paragraphs = dependencies.parseTopicSourceResponseParagraphs(sourceResponse)
    const blocks: QuestionSourceResponseClosingBlock[] = []
    let pendingAnswerParagraphs: string[] = []

    for (const paragraph of paragraphs) {
      if (!isQuestionSourceResponseParagraph(paragraph.text)) {
        pendingAnswerParagraphs.push(paragraph.text)
        continue
      }

      const questionParagraph = normalizeQuestionSourceResponsePrompt(paragraph.text)

      if (pendingAnswerParagraphs.length === 0) {
        throw new AnswerInterpretationError(
          `Question closing block "${questionParagraph}" in sourceResponse did not include an answer block.`,
        )
      }
      const answer = pendingAnswerParagraphs.join('\n\n')
      dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
        questionParagraph,
        answer,
        'Question closing block',
      )

      blocks.push(createQuestionResponseEntry(questionParagraph, answer))
      pendingAnswerParagraphs = []
    }

    if (pendingAnswerParagraphs.length > 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_closing_blocks requires each block to end with a question paragraph.',
      )
    }

    return blocks
  }

  function parseQuestionSourceResponseMiddleBlocks(sourceResponse: string) {
    const paragraphs = dependencies.parseTopicSourceResponseParagraphs(sourceResponse)
    const blocks: QuestionSourceResponseBlock[] = []
    let currentLeadingParagraphs: string[] = []
    let currentQuestion: string | undefined
    let trailingParagraphs: string[] = []

    for (const paragraph of paragraphs) {
      if (!isQuestionSourceResponseParagraph(paragraph.text)) {
        if (!currentQuestion) {
          currentLeadingParagraphs.push(paragraph.text)
        } else {
          trailingParagraphs.push(paragraph.text)
        }
        continue
      }

      if (!currentQuestion) {
        if (currentLeadingParagraphs.length === 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat question_middle_blocks requires each block to start with at least one leading paragraph before the question paragraph.',
          )
        }
        currentQuestion = normalizeQuestionSourceResponsePrompt(paragraph.text)
        trailingParagraphs = []
        continue
      }

      if (trailingParagraphs.length < 2) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat question_middle_blocks requires at least one trailing paragraph before the next question paragraph and at least one leading paragraph for that next block.',
        )
      }
      const answer = [...currentLeadingParagraphs, ...trailingParagraphs.slice(0, -1)].join('\n\n')
      dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
        currentQuestion,
        answer,
        'Question middle block',
      )

      blocks.push(createQuestionResponseEntry(currentQuestion, answer))
      currentLeadingParagraphs = [trailingParagraphs[trailingParagraphs.length - 1] as string]
      currentQuestion = normalizeQuestionSourceResponsePrompt(paragraph.text)
      trailingParagraphs = []
    }

    if (!currentQuestion) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_blocks requires at least one question anchor paragraph with leading and trailing answer paragraphs.',
      )
    }
    if (trailingParagraphs.length === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat question_middle_blocks requires each block to end with at least one trailing paragraph after the question paragraph.',
      )
    }
    const finalMiddleBlockAnswer = [...currentLeadingParagraphs, ...trailingParagraphs].join('\n\n')
    dependencies.assertQuestionAnswerTopicAuthorityMatchesQuestion(
      currentQuestion,
      finalMiddleBlockAnswer,
      'Question middle block',
    )
    blocks.push(createQuestionResponseEntry(currentQuestion, finalMiddleBlockAnswer))
    return blocks
  }

  function isQuestionSourceResponseParagraph(paragraph: string) {
    const trimmed = dependencies.stripLeadingQuestionPromptConjunction(paragraph)
    return (
      /[?？]\s*$/u.test(trimmed) ||
      Boolean(dependencies.inferCanonicalQuestionAnchorSummary(trimmed)) ||
      Boolean(dependencies.inferNonPunctuatedInterrogativeQuestionAuthority(trimmed))
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
    const nonPunctuatedQuestionAuthority =
      dependencies.inferNonPunctuatedInterrogativeQuestionAuthority(trimmed)
    if (nonPunctuatedQuestionAuthority) {
      return nonPunctuatedQuestionAuthority
    }
    return dependencies.normalizeEmbeddedQuestionAnchorText(trimmed)
  }

  function isQuestionSourceResponseSentence(sentence: string) {
    const trimmed = dependencies.stripLeadingQuestionPromptConjunction(sentence)
    return (
      /[?？]\s*$/u.test(trimmed) ||
      Boolean(dependencies.inferCanonicalQuestionAnchorSummary(trimmed)) ||
      Boolean(dependencies.inferNonPunctuatedInterrogativeQuestionAuthority(trimmed))
    )
  }

  return {
    isQuestionSourceResponseParagraph,
    isQuestionSourceResponseSentence,
    normalizeQuestionSourceResponsePrompt,
    parseQuestionSourceResponseBlocks,
    parseQuestionSourceResponseClauses,
    parseQuestionSourceResponseClosingBlocks,
    parseQuestionSourceResponseClosingSpans,
    parseQuestionSourceResponseMiddleBlocks,
    parseQuestionSourceResponseMiddleSpans,
    parseQuestionSourceResponseSpans,
    parseRequiredQuestionSourceResponseBlocks,
    parseRequiredQuestionSourceResponseClauses,
    parseRequiredQuestionSourceResponseClosingBlocks,
    parseRequiredQuestionSourceResponseClosingSpans,
    parseRequiredQuestionSourceResponseMiddleBlocks,
    parseRequiredQuestionSourceResponseMiddleSpans,
    parseRequiredQuestionSourceResponseSpans,
  }
}
