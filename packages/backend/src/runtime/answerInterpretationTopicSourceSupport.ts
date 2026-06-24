import { AnswerInterpretationError } from './answerInterpretationErrors'
import { normalizeSourceResponseText } from './answerInterpretationStrings'
import type {
  EmbeddedMatchingRunToken,
  EmbeddedTopicAnchor,
  InterpretedSourceResponseState,
  TopicSourceResponseBlock,
  TopicSourceResponseClosingBlock,
  TopicSourceResponseClosingSpan,
  TopicSourceResponseParagraph,
  TopicSourceResponseSentence,
  TopicSourceResponseSpan,
} from './answerInterpretationTypes'

interface TopicSourceSupportDependencies {
  findMatchingNormalizedTopicLabels: (
    normalizedText: string,
    normalizedCandidateLabels: Set<string>,
  ) => string[]
  inferEmbeddedClosingTopicCandidateLabels: (
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
  ) => string[]
  inferEmbeddedLeadingTopicCandidateLabels: (
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
  ) => string[]
  inferTopicBlockAnchorLabelsFromParagraph: (paragraph: string) => string[]
  inferTopicClosingBlockLabelsFromParagraph: (paragraph: string) => string[]
  inferTopicClosingSpanLabelsFromSentence: (sentence: string) => string[]
  inferTopicSpanAnchorLabelsFromSentence: (sentence: string) => string[]
  normalizeEmbeddedMatchingRunText: (text: string) => string
  parsePendingSourceResponseConjunctions: (sourceResponse: string) => string[]
  parseTopicSourceResponseClauses: (sourceResponse: string) => TopicSourceResponseSentence[]
  parseTopicSourceResponseParagraphs: (sourceResponse: string) => TopicSourceResponseParagraph[]
  parseTopicSourceResponseSentences: (sourceResponse: string) => TopicSourceResponseSentence[]
  resolveEmbeddedTopicAnchors: (
    sourceResponse: string,
    tokens: EmbeddedMatchingRunToken[],
    candidateLabels: string[],
    sourceResponseFormat: 'topic_spans' | 'topic_middle_spans' | 'topic_closing_spans',
  ) => EmbeddedTopicAnchor[]
  resolveSingleTopicAnchorLabel: (
    text: string,
    matchingLabels: string[],
    multipleMatchMessage: string,
    inferLabels: (text: string) => string[],
  ) => string | undefined
  tokenizeEmbeddedMatchingRunSourceResponse: (sourceResponse: string) => EmbeddedMatchingRunToken[]
}

export function createAnswerInterpretationTopicSourceSupport(
  dependencies: TopicSourceSupportDependencies,
) {
  function requireSourceResponse(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseFormat:
      | 'topic_clauses'
      | 'topic_sentences'
      | 'topic_spans'
      | 'topic_middle_spans'
      | 'topic_closing_spans'
      | 'topic_closing_blocks'
      | 'topic_paragraphs'
      | 'topic_middle_blocks'
      | 'topic_blocks',
  ) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} requires sourceResponse for ${label}.`,
      )
    }
    return shared
  }

  function resolveEmbeddedTopicCandidateLabels(
    normalizedCandidateLabels: Set<string>,
    inferredLabels: string[],
  ) {
    return [...new Set([...normalizedCandidateLabels, ...inferredLabels.filter(Boolean)])]
  }

  function parseRequiredTopicSourceResponseClauses(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.topicClauses) {
      return sourceResponseState.topicClauses
    }

    const shared = requireSourceResponse(sourceResponse, label, 'topic_clauses')
    const clauseCandidates = sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>()
    const sentenceClauses = dependencies.parseTopicSourceResponseClauses(shared)
    if (sentenceClauses.length === 1) {
      const embeddedClauses = parseEmbeddedTopicSourceResponseClauses(shared, clauseCandidates)
      if (embeddedClauses) {
        if (sourceResponseState) {
          sourceResponseState.topicClauses = embeddedClauses
        }
        return embeddedClauses
      }
    }

    if (sourceResponseState) {
      sourceResponseState.topicClauses = sentenceClauses
    }
    return sentenceClauses
  }

  function parseRequiredTopicSourceResponseSentences(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.topicSentences) {
      return sourceResponseState.topicSentences
    }

    const sentences = dependencies.parseTopicSourceResponseSentences(
      requireSourceResponse(sourceResponse, label, 'topic_sentences'),
    )
    if (sourceResponseState) {
      sourceResponseState.topicSentences = sentences
    }
    return sentences
  }

  function parseRequiredTopicSourceResponseSpans(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.topicSpans) {
      return sourceResponseState.topicSpans
    }

    const shared = requireSourceResponse(sourceResponse, label, 'topic_spans')
    if (dependencies.parseTopicSourceResponseSentences(shared).length === 1) {
      const embeddedSpans = parseEmbeddedTopicSourceResponseSpans(
        shared,
        sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
      )
      if (embeddedSpans) {
        if (sourceResponseState) {
          sourceResponseState.topicSpans = embeddedSpans
        }
        return embeddedSpans
      }
    }

    const spans = parseTopicSourceResponseSpans(
      dependencies.parseTopicSourceResponseSentences(shared),
      sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
    )
    if (sourceResponseState) {
      sourceResponseState.topicSpans = spans
    }
    return spans
  }

  function parseEmbeddedTopicSourceResponseSpans(
    sourceResponse: string,
    normalizedCandidateLabels: Set<string>,
  ) {
    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
    if (tokens.length === 0) {
      return undefined
    }

    const candidateLabels = resolveEmbeddedTopicCandidateLabels(
      normalizedCandidateLabels,
      normalizedCandidateLabels.size > 1
        ? []
        : dependencies.inferEmbeddedLeadingTopicCandidateLabels(sourceResponse, tokens),
    )
    const anchors = dependencies.resolveEmbeddedTopicAnchors(
      sourceResponse,
      tokens,
      candidateLabels,
      'topic_spans',
    )
    if (anchors.length === 0) {
      return undefined
    }

    if (anchors[0]?.startTokenIndex !== 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_spans requires sourceResponse to start with a topic anchor sentence.',
      )
    }

    const spans: TopicSourceResponseSpan[] = []
    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] as EmbeddedTopicAnchor
      const nextAnchor = anchors[index + 1]

      if (nextAnchor) {
        if (nextAnchor.startTokenIndex === anchor.endTokenIndex) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat topic_spans requires each span to include answer text after the topic anchor.',
          )
        }
      } else if (anchor.endTokenIndex >= tokens.length) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_spans requires each span to include answer text after the topic anchor.',
        )
      }

      const endOriginal = nextAnchor?.startOriginal ?? sourceResponse.length
      const text = dependencies.normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(anchor.startOriginal, endOriginal),
      )
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        normalizeSourceResponseText(text),
        normalizedCandidateLabels,
      )
      if (matchingLabels.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple topic span anchors matched sentence "${text}" in sourceResponse.`,
        )
      }

      spans.push({
        text,
        anchorText: text,
        normalizedAnchorLabel: matchingLabels[0] ?? anchor.normalizedLabel,
      })
    }

    return spans
  }

  function parseRequiredTopicSourceResponseMiddleSpans(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.topicMiddleSpans) {
      return sourceResponseState.topicMiddleSpans
    }

    const shared = requireSourceResponse(sourceResponse, label, 'topic_middle_spans')
    if (dependencies.parseTopicSourceResponseSentences(shared).length === 1) {
      const embeddedSpans = parseEmbeddedTopicSourceResponseMiddleSpans(
        shared,
        sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
      )
      if (embeddedSpans) {
        if (sourceResponseState) {
          sourceResponseState.topicMiddleSpans = embeddedSpans
        }
        return embeddedSpans
      }
    }

    const spans = parseTopicSourceResponseMiddleSpans(
      dependencies.parseTopicSourceResponseSentences(shared),
      sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
    )
    if (sourceResponseState) {
      sourceResponseState.topicMiddleSpans = spans
    }
    return spans
  }

  function parseEmbeddedTopicSourceResponseMiddleSpans(
    sourceResponse: string,
    normalizedCandidateLabels: Set<string>,
  ) {
    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
    if (tokens.length === 0) {
      return undefined
    }

    const candidateLabels = resolveEmbeddedTopicCandidateLabels(
      normalizedCandidateLabels,
      normalizedCandidateLabels.size > 1
        ? []
        : dependencies.inferEmbeddedLeadingTopicCandidateLabels(sourceResponse, tokens),
    )
    const anchors = dependencies.resolveEmbeddedTopicAnchors(
      sourceResponse,
      tokens,
      candidateLabels,
      'topic_middle_spans',
    )
    if (anchors.length === 0) {
      return undefined
    }

    if (anchors[0]?.startTokenIndex === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_middle_spans requires each span to start with at least one leading sentence before the topic anchor sentence.',
      )
    }

    const spans: TopicSourceResponseSpan[] = []
    let currentSpanStartOriginal = 0

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] as EmbeddedTopicAnchor
      const nextAnchor = anchors[index + 1]
      const trailingTokenCount = tokens.length - anchor.endTokenIndex

      if (index === anchors.length - 1) {
        if (trailingTokenCount === 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat topic_middle_spans requires each span to end with at least one trailing sentence after the topic anchor sentence.',
          )
        }

        const text = dependencies.normalizeEmbeddedMatchingRunText(
          sourceResponse.slice(currentSpanStartOriginal),
        )
        const anchorText = dependencies.normalizeEmbeddedMatchingRunText(
          sourceResponse.slice(anchor.startOriginal),
        )
        const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
          normalizeSourceResponseText(text),
          normalizedCandidateLabels,
        )
        if (matchingLabels.length > 1) {
          throw new AnswerInterpretationError(
            `Multiple topic middle span anchors matched sentence "${text}" in sourceResponse.`,
          )
        }

        spans.push({
          text,
          anchorText,
          normalizedAnchorLabel: matchingLabels[0] ?? anchor.normalizedLabel,
        })
        break
      }

      if (!nextAnchor) {
        break
      }

      const gapTokenCount = nextAnchor.startTokenIndex - anchor.endTokenIndex
      if (gapTokenCount < 2) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_middle_spans requires at least one trailing sentence before the next topic anchor sentence and at least one leading sentence for that next span.',
        )
      }

      const nextSpanLeadingTokenStartOriginal =
        tokens[nextAnchor.startTokenIndex - 1]?.start ?? sourceResponse.length
      const text = dependencies.normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(currentSpanStartOriginal, nextSpanLeadingTokenStartOriginal),
      )
      const anchorText = dependencies.normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(anchor.startOriginal, nextSpanLeadingTokenStartOriginal),
      )
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        normalizeSourceResponseText(text),
        normalizedCandidateLabels,
      )
      if (matchingLabels.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple topic middle span anchors matched sentence "${text}" in sourceResponse.`,
        )
      }

      spans.push({
        text,
        anchorText,
        normalizedAnchorLabel: matchingLabels[0] ?? anchor.normalizedLabel,
      })
      currentSpanStartOriginal = nextSpanLeadingTokenStartOriginal
    }

    return spans
  }

  function parseRequiredTopicSourceResponseClosingSpans(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.topicClosingSpans) {
      return sourceResponseState.topicClosingSpans
    }

    const shared = requireSourceResponse(sourceResponse, label, 'topic_closing_spans')
    if (dependencies.parseTopicSourceResponseSentences(shared).length === 1) {
      const embeddedSpans = parseEmbeddedTopicSourceResponseClosingSpans(
        shared,
        sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
      )
      if (embeddedSpans) {
        if (sourceResponseState) {
          sourceResponseState.topicClosingSpans = embeddedSpans
        }
        return embeddedSpans
      }
    }

    const spans = parseTopicSourceResponseClosingSpans(
      dependencies.parseTopicSourceResponseSentences(shared),
      sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
    )
    if (sourceResponseState) {
      sourceResponseState.topicClosingSpans = spans
    }
    return spans
  }

  function parseEmbeddedTopicSourceResponseClosingSpans(
    sourceResponse: string,
    normalizedCandidateLabels: Set<string>,
  ) {
    const tokens = dependencies.tokenizeEmbeddedMatchingRunSourceResponse(sourceResponse)
    if (tokens.length === 0) {
      return undefined
    }

    const candidateLabels = resolveEmbeddedTopicCandidateLabels(
      normalizedCandidateLabels,
      normalizedCandidateLabels.size > 1
        ? []
        : dependencies.inferEmbeddedClosingTopicCandidateLabels(sourceResponse, tokens),
    )
    const anchors = dependencies.resolveEmbeddedTopicAnchors(
      sourceResponse,
      tokens,
      candidateLabels,
      'topic_closing_spans',
    )
    if (anchors.length === 0) {
      return undefined
    }

    if (anchors[0]?.startTokenIndex === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_closing_spans requires each span to include at least one leading sentence before the topic-closing anchor.',
      )
    }

    const spans: TopicSourceResponseClosingSpan[] = []
    let previousEndTokenIndex = 0
    let previousEndOriginal = 0

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index] as EmbeddedTopicAnchor

      if (index > 0 && anchor.startTokenIndex === previousEndTokenIndex) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_closing_spans requires at least one leading sentence before the next topic-closing anchor.',
        )
      }

      const hasTrailingTokens = anchor.endTokenIndex < tokens.length
      if (index === anchors.length - 1 && hasTrailingTokens) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_closing_spans requires each span to end with a topic-closing sentence.',
        )
      }

      const nextTokenStartOriginal = tokens[anchor.endTokenIndex]?.start ?? sourceResponse.length
      const text = dependencies.normalizeEmbeddedMatchingRunText(
        sourceResponse.slice(previousEndOriginal, nextTokenStartOriginal),
      )
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        normalizeSourceResponseText(text),
        normalizedCandidateLabels,
      )
      if (matchingLabels.length > 1) {
        throw new AnswerInterpretationError(
          `Multiple topic closing span anchors matched sentence "${text}" in sourceResponse.`,
        )
      }

      spans.push({
        text,
        closingText: text,
        normalizedClosingLabel: matchingLabels[0] ?? anchor.normalizedLabel,
      })
      previousEndTokenIndex = anchor.endTokenIndex
      previousEndOriginal = nextTokenStartOriginal
    }

    return spans
  }

  function parseRequiredTopicSourceResponseClosingBlocks(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.topicClosingBlocks) {
      return sourceResponseState.topicClosingBlocks
    }

    const shared = requireSourceResponse(sourceResponse, label, 'topic_closing_blocks')
    const blocks = parseTopicSourceResponseClosingBlocks(
      dependencies.parseTopicSourceResponseParagraphs(shared),
      sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
    )
    if (sourceResponseState) {
      sourceResponseState.topicClosingBlocks = blocks
    }
    return blocks
  }

  function parseRequiredTopicSourceResponseParagraphs(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.topicParagraphs) {
      return sourceResponseState.topicParagraphs
    }

    const paragraphs = dependencies.parseTopicSourceResponseParagraphs(
      requireSourceResponse(sourceResponse, label, 'topic_paragraphs'),
    )
    if (sourceResponseState) {
      sourceResponseState.topicParagraphs = paragraphs
    }
    return paragraphs
  }

  function parseRequiredTopicSourceResponseMiddleBlocks(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.topicMiddleBlocks) {
      return sourceResponseState.topicMiddleBlocks
    }

    const shared = requireSourceResponse(sourceResponse, label, 'topic_middle_blocks')
    const blocks = parseTopicSourceResponseMiddleBlocks(
      dependencies.parseTopicSourceResponseParagraphs(shared),
      sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
    )
    if (sourceResponseState) {
      sourceResponseState.topicMiddleBlocks = blocks
    }
    return blocks
  }

  function parseRequiredTopicSourceResponseBlocks(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.topicBlocks) {
      return sourceResponseState.topicBlocks
    }

    const shared = requireSourceResponse(sourceResponse, label, 'topic_blocks')
    const blocks = parseTopicSourceResponseBlocks(
      dependencies.parseTopicSourceResponseParagraphs(shared),
      sourceResponseState?.topicAnchorCandidateLabels ?? new Set<string>(),
    )
    if (sourceResponseState) {
      sourceResponseState.topicBlocks = blocks
    }
    return blocks
  }

  function parseEmbeddedTopicSourceResponseClauses(
    sourceResponse: string,
    normalizedCandidateLabels: Set<string>,
  ) {
    const segments = dependencies.parsePendingSourceResponseConjunctions(sourceResponse)
    if (segments.length <= 1) {
      return undefined
    }

    const clauses = segments.map((segment) => ({
      text: segment,
      normalizedText: normalizeSourceResponseText(segment),
    }))

    for (const clause of clauses) {
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        clause.normalizedText,
        normalizedCandidateLabels,
      )
      const anchorLabel = dependencies.resolveSingleTopicAnchorLabel(
        clause.text,
        matchingLabels,
        `Multiple topic clause anchors matched conjunction segment "${clause.text}" in sourceResponse.`,
        dependencies.inferTopicSpanAnchorLabelsFromSentence,
      )
      if (!anchorLabel) {
        return undefined
      }
    }

    return clauses
  }

  function parseTopicSourceResponseSpans(
    sentences: TopicSourceResponseSentence[],
    normalizedCandidateLabels: Set<string>,
  ) {
    const spans: TopicSourceResponseSpan[] = []
    let currentSpan: TopicSourceResponseSpan | undefined

    for (const sentence of sentences) {
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        sentence.normalizedText,
        normalizedCandidateLabels,
      )

      const anchorLabel = dependencies.resolveSingleTopicAnchorLabel(
        sentence.text,
        matchingLabels,
        `Multiple topic span anchors matched sentence "${sentence.text}" in sourceResponse.`,
        dependencies.inferTopicSpanAnchorLabelsFromSentence,
      )
      if (anchorLabel) {
        if (currentSpan) {
          spans.push(currentSpan)
        }
        currentSpan = {
          text: sentence.text,
          anchorText: sentence.text,
          normalizedAnchorLabel: anchorLabel,
        }
        continue
      }

      if (!currentSpan) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_spans requires sourceResponse to start with a topic anchor sentence.',
        )
      }

      currentSpan = {
        ...currentSpan,
        text: `${currentSpan.text} ${sentence.text}`,
      }
    }

    if (currentSpan) {
      spans.push(currentSpan)
    }

    return spans
  }

  function parseTopicSourceResponseMiddleSpans(
    sentences: TopicSourceResponseSentence[],
    normalizedCandidateLabels: Set<string>,
  ) {
    const spans: TopicSourceResponseSpan[] = []
    let currentLeadingSentences: string[] = []
    let currentAnchor: TopicSourceResponseSentence | undefined
    let currentAnchorLabel: string | undefined
    let trailingSentences: string[] = []

    for (const sentence of sentences) {
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        sentence.normalizedText,
        normalizedCandidateLabels,
      )

      const anchorLabel = dependencies.resolveSingleTopicAnchorLabel(
        sentence.text,
        matchingLabels,
        `Multiple topic middle span anchors matched sentence "${sentence.text}" in sourceResponse.`,
        dependencies.inferTopicSpanAnchorLabelsFromSentence,
      )
      if (!anchorLabel) {
        if (!currentAnchor) {
          currentLeadingSentences.push(sentence.text)
        } else {
          trailingSentences.push(sentence.text)
        }
        continue
      }

      if (!currentAnchor) {
        if (currentLeadingSentences.length === 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat topic_middle_spans requires each span to start with at least one leading sentence before the topic anchor sentence.',
          )
        }
        currentAnchor = sentence
        currentAnchorLabel = anchorLabel
        trailingSentences = []
        continue
      }

      if (trailingSentences.length < 2) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_middle_spans requires at least one trailing sentence before the next topic anchor sentence and at least one leading sentence for that next span.',
        )
      }

      spans.push({
        text: [
          ...currentLeadingSentences,
          currentAnchor.text,
          ...trailingSentences.slice(0, -1),
        ].join(' '),
        anchorText: currentAnchor.text,
        normalizedAnchorLabel: currentAnchorLabel ?? currentAnchor.normalizedText,
      })
      currentLeadingSentences = [trailingSentences[trailingSentences.length - 1] as string]
      currentAnchor = sentence
      currentAnchorLabel = anchorLabel
      trailingSentences = []
    }

    if (!currentAnchor) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_middle_spans requires at least one topic anchor sentence with leading and trailing continuation sentences.',
      )
    }

    if (trailingSentences.length === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_middle_spans requires each span to end with at least one trailing sentence after the topic anchor sentence.',
      )
    }

    spans.push({
      text: [...currentLeadingSentences, currentAnchor.text, ...trailingSentences].join(' '),
      anchorText: currentAnchor.text,
      normalizedAnchorLabel: currentAnchorLabel ?? currentAnchor.normalizedText,
    })

    return spans
  }

  function parseTopicSourceResponseClosingSpans(
    sentences: TopicSourceResponseSentence[],
    normalizedCandidateLabels: Set<string>,
  ) {
    const spans: TopicSourceResponseClosingSpan[] = []
    let pendingSentences: string[] = []

    for (const sentence of sentences) {
      pendingSentences.push(sentence.text)
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        sentence.normalizedText,
        normalizedCandidateLabels,
      )

      const closingLabel = dependencies.resolveSingleTopicAnchorLabel(
        sentence.text,
        matchingLabels,
        `Multiple topic closing span anchors matched sentence "${sentence.text}" in sourceResponse.`,
        dependencies.inferTopicClosingSpanLabelsFromSentence,
      )
      if (!closingLabel) {
        continue
      }

      spans.push({
        text: pendingSentences.join(' '),
        closingText: sentence.text,
        normalizedClosingLabel: closingLabel,
      })
      pendingSentences = []
    }

    if (pendingSentences.length > 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_closing_spans requires each span to end with a topic-closing sentence.',
      )
    }

    return spans
  }

  function parseTopicSourceResponseClosingBlocks(
    paragraphs: TopicSourceResponseParagraph[],
    normalizedCandidateLabels: Set<string>,
  ) {
    const blocks: TopicSourceResponseClosingBlock[] = []
    let pendingParagraphs: string[] = []

    for (const paragraph of paragraphs) {
      pendingParagraphs.push(paragraph.text)
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        paragraph.normalizedText,
        normalizedCandidateLabels,
      )

      const closingLabel = dependencies.resolveSingleTopicAnchorLabel(
        paragraph.text,
        matchingLabels,
        `Multiple topic closing block anchors matched paragraph "${paragraph.text}" in sourceResponse.`,
        dependencies.inferTopicClosingBlockLabelsFromParagraph,
      )
      if (!closingLabel) {
        continue
      }

      blocks.push({
        text: pendingParagraphs.join('\n\n'),
        closingText: paragraph.text,
        normalizedClosingLabel: closingLabel,
      })
      pendingParagraphs = []
    }

    if (pendingParagraphs.length > 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_closing_blocks requires each block to end with a topic-closing paragraph.',
      )
    }

    return blocks
  }

  function parseTopicSourceResponseBlocks(
    paragraphs: TopicSourceResponseParagraph[],
    normalizedCandidateLabels: Set<string>,
  ) {
    const blocks: TopicSourceResponseBlock[] = []
    let currentBlock: TopicSourceResponseBlock | undefined

    for (const paragraph of paragraphs) {
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        paragraph.normalizedText,
        normalizedCandidateLabels,
      )

      const anchorLabel = dependencies.resolveSingleTopicAnchorLabel(
        paragraph.text,
        matchingLabels,
        `Multiple topic block anchors matched paragraph "${paragraph.text}" in sourceResponse.`,
        dependencies.inferTopicBlockAnchorLabelsFromParagraph,
      )
      if (anchorLabel) {
        if (currentBlock) {
          blocks.push(currentBlock)
        }
        currentBlock = {
          text: paragraph.text,
          anchorText: paragraph.text,
          normalizedAnchorLabel: anchorLabel,
        }
        continue
      }

      if (!currentBlock) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_blocks requires sourceResponse to start with a topic anchor paragraph.',
        )
      }

      currentBlock = {
        ...currentBlock,
        text: `${currentBlock.text}\n\n${paragraph.text}`,
      }
    }

    if (currentBlock) {
      blocks.push(currentBlock)
    }

    return blocks
  }

  function parseTopicSourceResponseMiddleBlocks(
    paragraphs: TopicSourceResponseParagraph[],
    normalizedCandidateLabels: Set<string>,
  ) {
    const blocks: TopicSourceResponseBlock[] = []
    let currentLeadingParagraphs: string[] = []
    let currentAnchor: TopicSourceResponseParagraph | undefined
    let currentAnchorLabel: string | undefined
    let trailingParagraphs: string[] = []

    for (const paragraph of paragraphs) {
      const matchingLabels = dependencies.findMatchingNormalizedTopicLabels(
        paragraph.normalizedText,
        normalizedCandidateLabels,
      )

      const anchorLabel = dependencies.resolveSingleTopicAnchorLabel(
        paragraph.text,
        matchingLabels,
        `Multiple topic middle block anchors matched paragraph "${paragraph.text}" in sourceResponse.`,
        dependencies.inferTopicBlockAnchorLabelsFromParagraph,
      )
      if (!anchorLabel) {
        if (!currentAnchor) {
          currentLeadingParagraphs.push(paragraph.text)
        } else {
          trailingParagraphs.push(paragraph.text)
        }
        continue
      }

      if (!currentAnchor) {
        if (currentLeadingParagraphs.length === 0) {
          throw new AnswerInterpretationError(
            'sourceResponseFormat topic_middle_blocks requires each block to start with at least one leading paragraph before the topic anchor paragraph.',
          )
        }
        currentAnchor = paragraph
        currentAnchorLabel = anchorLabel
        trailingParagraphs = []
        continue
      }

      if (trailingParagraphs.length < 2) {
        throw new AnswerInterpretationError(
          'sourceResponseFormat topic_middle_blocks requires at least one trailing paragraph before the next topic anchor paragraph and at least one leading paragraph for that next block.',
        )
      }

      blocks.push({
        text: [
          ...currentLeadingParagraphs,
          currentAnchor.text,
          ...trailingParagraphs.slice(0, -1),
        ].join('\n\n'),
        anchorText: currentAnchor.text,
        normalizedAnchorLabel: currentAnchorLabel ?? currentAnchor.normalizedText,
      })
      currentLeadingParagraphs = [trailingParagraphs[trailingParagraphs.length - 1] as string]
      currentAnchor = paragraph
      currentAnchorLabel = anchorLabel
      trailingParagraphs = []
    }

    if (!currentAnchor) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_middle_blocks requires at least one topic anchor paragraph with leading and trailing continuation paragraphs.',
      )
    }

    if (trailingParagraphs.length === 0) {
      throw new AnswerInterpretationError(
        'sourceResponseFormat topic_middle_blocks requires each block to end with at least one trailing paragraph after the topic anchor paragraph.',
      )
    }

    blocks.push({
      text: [...currentLeadingParagraphs, currentAnchor.text, ...trailingParagraphs].join('\n\n'),
      anchorText: currentAnchor.text,
      normalizedAnchorLabel: currentAnchorLabel ?? currentAnchor.normalizedText,
    })

    return blocks
  }

  return {
    parseRequiredTopicSourceResponseBlocks,
    parseRequiredTopicSourceResponseClauses,
    parseRequiredTopicSourceResponseClosingBlocks,
    parseRequiredTopicSourceResponseClosingSpans,
    parseRequiredTopicSourceResponseMiddleBlocks,
    parseRequiredTopicSourceResponseMiddleSpans,
    parseRequiredTopicSourceResponseParagraphs,
    parseRequiredTopicSourceResponseSentences,
    parseRequiredTopicSourceResponseSpans,
  }
}
