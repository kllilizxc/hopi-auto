import { AnswerInterpretationError } from './answerInterpretationErrors'
import type {
  InterpretedSourceResponseState,
  TopicSourceResponseBlock,
  TopicSourceResponseClosingBlock,
  TopicSourceResponseClosingSpan,
  TopicSourceResponseParagraph,
  TopicSourceResponseSentence,
  TopicSourceResponseSpan,
} from './answerInterpretationTypes'

interface TopicSourceResponseSectionSupportDependencies {
  assertTopicAnswerTextDoesNotContainQuestionAuthority: (text: string, unitLabel: string) => void
  assertTopicTextHasSubstantiveLeadingAnswerContent: (text: string, unitLabel: string) => void
  extractTopicAnchorCandidateSummariesFromText: (text: string) => string[]
  findMatchingTopicBlockIndexes: (
    blocks: TopicSourceResponseBlock[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  findMatchingTopicClauseIndexes: (
    clauses: TopicSourceResponseSentence[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  findMatchingTopicClosingBlockIndexes: (
    blocks: TopicSourceResponseClosingBlock[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  findMatchingTopicClosingSpanIndexes: (
    spans: TopicSourceResponseClosingSpan[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  findMatchingTopicParagraphIndexes: (
    paragraphs: TopicSourceResponseParagraph[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  findMatchingTopicSentenceIndexes: (
    sentences: TopicSourceResponseSentence[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  findMatchingTopicSpanIndexes: (
    spans: TopicSourceResponseSpan[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  markConsumedMatchingIndexes: (
    consumedIndexes: Set<number> | undefined,
    matchingIndexes: number[],
  ) => void
  paragraphTextImpliesMultipleTopicSummaries: (text: string) => boolean
  parseRequiredTopicSourceResponseBlocks: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => TopicSourceResponseBlock[]
  parseRequiredTopicSourceResponseClauses: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => TopicSourceResponseSentence[]
  parseRequiredTopicSourceResponseClosingBlocks: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => TopicSourceResponseClosingBlock[]
  parseRequiredTopicSourceResponseClosingSpans: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => TopicSourceResponseClosingSpan[]
  parseRequiredTopicSourceResponseMiddleBlocks: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => TopicSourceResponseBlock[]
  parseRequiredTopicSourceResponseMiddleSpans: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => TopicSourceResponseSpan[]
  parseRequiredTopicSourceResponseParagraphs: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => TopicSourceResponseParagraph[]
  parseRequiredTopicSourceResponseSentences: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => TopicSourceResponseSentence[]
  parseRequiredTopicSourceResponseSpans: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => TopicSourceResponseSpan[]
  registerTopicAnchorCandidates: (
    sourceResponseState: InterpretedSourceResponseState | undefined,
    candidateGroups: string[][],
  ) => void
  resolveContiguousMatchingIndexes: (
    matchingIndexes: number[],
    multipleMatchErrorMessage: string,
  ) => number[]
}

export function createAnswerInterpretationTopicSourceResponseSectionSupport(
  dependencies: TopicSourceResponseSectionSupportDependencies,
) {
  function consumeContiguousTopicSourceResponseText(
    matches: Array<{ text: string }>,
    matchingIndexes: number[],
    multipleMatchErrorMessage: string,
    consumedIndexes: Set<number> | undefined,
    joiner: string,
    rejectMultipleInferredTopicSummaries = false,
  ) {
    const contiguousMatchingIndexes = dependencies.resolveContiguousMatchingIndexes(
      matchingIndexes,
      multipleMatchErrorMessage,
    )
    const firstMatchIndex = contiguousMatchingIndexes[0]
    if (firstMatchIndex === undefined) {
      return undefined
    }

    if (rejectMultipleInferredTopicSummaries) {
      for (const matchingIndex of contiguousMatchingIndexes) {
        const text = matches[matchingIndex]?.text
        if (
          text &&
          dependencies.extractTopicAnchorCandidateSummariesFromText(text).length > 1
        ) {
          throw new AnswerInterpretationError(multipleMatchErrorMessage)
        }
      }
    }

    dependencies.markConsumedMatchingIndexes(consumedIndexes, contiguousMatchingIndexes)
    if (contiguousMatchingIndexes.length === 1) {
      return matches[firstMatchIndex]?.text
    }

    return contiguousMatchingIndexes
      .map((matchingIndex) => matches[matchingIndex]?.text)
      .filter((text): text is string => text !== undefined)
      .join(joiner)
  }

  function consumeTopicSentenceSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
    rejectMultipleInferredTopicSummaries = false,
  ) {
    const sentences = dependencies.parseRequiredTopicSourceResponseSentences(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes = sourceResponseState?.consumedTopicSentenceIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingTopicSentenceIndexes(
      sentences,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(`No topic sentence matched ${label} in sourceResponse.`)
    }
    for (const matchingIndex of matchingIndexes) {
      const text = sentences[matchingIndex]?.text
      if (text) {
        dependencies.assertTopicTextHasSubstantiveLeadingAnswerContent(text, 'topic sentence')
        dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(text, 'Topic sentence')
      }
    }
    return consumeContiguousTopicSourceResponseText(
      sentences,
      matchingIndexes,
      `Multiple topic sentences matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedTopicSentenceIndexes,
      ' ',
      rejectMultipleInferredTopicSummaries,
    )
  }

  function consumeTopicClauseSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
    rejectMultipleInferredTopicSummaries = false,
  ) {
    const clauses = dependencies.parseRequiredTopicSourceResponseClauses(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes = sourceResponseState?.consumedTopicClauseIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingTopicClauseIndexes(
      clauses,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(`No topic clause matched ${label} in sourceResponse.`)
    }
    for (const matchingIndex of matchingIndexes) {
      const text = clauses[matchingIndex]?.text
      if (text) {
        dependencies.assertTopicTextHasSubstantiveLeadingAnswerContent(text, 'topic clause')
        dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(text, 'Topic clause')
      }
    }
    return consumeContiguousTopicSourceResponseText(
      clauses,
      matchingIndexes,
      `Multiple topic clauses matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedTopicClauseIndexes,
      ' ',
      rejectMultipleInferredTopicSummaries,
    )
  }

  function consumeTopicSpanSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    dependencies.registerTopicAnchorCandidates(sourceResponseState, [candidates])
    const spans = dependencies.parseRequiredTopicSourceResponseSpans(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes = sourceResponseState?.consumedTopicSpanIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingTopicSpanIndexes(
      spans,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(`No topic span matched ${label} in sourceResponse.`)
    }
    for (const matchingIndex of matchingIndexes) {
      const span = spans[matchingIndex]
      const anchorText = span?.anchorText
      if (anchorText) {
        dependencies.assertTopicTextHasSubstantiveLeadingAnswerContent(
          anchorText,
          'topic span anchor sentence',
        )
      }
      if (span?.text) {
        dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(
          span.text,
          'Topic span',
        )
      }
    }
    return consumeContiguousTopicSourceResponseText(
      spans,
      matchingIndexes,
      `Multiple topic spans matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedTopicSpanIndexes,
      ' ',
    )
  }

  function consumeTopicMiddleSpanSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    dependencies.registerTopicAnchorCandidates(sourceResponseState, [candidates])
    const spans = dependencies.parseRequiredTopicSourceResponseMiddleSpans(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedTopicMiddleSpanIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingTopicSpanIndexes(
      spans,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(
        `No topic middle span matched ${label} in sourceResponse.`,
      )
    }
    for (const matchingIndex of matchingIndexes) {
      const span = spans[matchingIndex]
      const anchorText = span?.anchorText
      if (anchorText) {
        dependencies.assertTopicTextHasSubstantiveLeadingAnswerContent(
          anchorText,
          'topic middle span anchor sentence',
        )
      }
      if (span?.text) {
        dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(
          span.text,
          'Topic middle span',
        )
      }
    }
    return consumeContiguousTopicSourceResponseText(
      spans,
      matchingIndexes,
      `Multiple topic middle spans matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedTopicMiddleSpanIndexes,
      ' ',
    )
  }

  function consumeTopicClosingSpanSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    dependencies.registerTopicAnchorCandidates(sourceResponseState, [candidates])
    const spans = dependencies.parseRequiredTopicSourceResponseClosingSpans(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedTopicClosingSpanIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingTopicClosingSpanIndexes(
      spans,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(
        `No topic closing span matched ${label} in sourceResponse.`,
      )
    }
    for (const matchingIndex of matchingIndexes) {
      const span = spans[matchingIndex]
      const closingText = span?.closingText
      if (closingText) {
        dependencies.assertTopicTextHasSubstantiveLeadingAnswerContent(
          closingText,
          'topic closing span sentence',
        )
      }
      if (span?.text) {
        dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(
          span.text,
          'Topic closing span',
        )
      }
    }
    return consumeContiguousTopicSourceResponseText(
      spans,
      matchingIndexes,
      `Multiple topic closing spans matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedTopicClosingSpanIndexes,
      ' ',
    )
  }

  function consumeTopicClosingBlockSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
    rejectMultipleInferredTopicSummaries = false,
  ) {
    dependencies.registerTopicAnchorCandidates(sourceResponseState, [candidates])
    const blocks = dependencies.parseRequiredTopicSourceResponseClosingBlocks(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedTopicClosingBlockIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingTopicClosingBlockIndexes(
      blocks,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(
        `No topic closing block matched ${label} in sourceResponse.`,
      )
    }
    if (rejectMultipleInferredTopicSummaries) {
      for (const matchingIndex of matchingIndexes) {
        const closingText = blocks[matchingIndex]?.closingText
        if (
          closingText &&
          dependencies.paragraphTextImpliesMultipleTopicSummaries(closingText)
        ) {
          throw new AnswerInterpretationError(
            `Multiple topic closing blocks matched ${label} in sourceResponse.`,
          )
        }
      }
    }
    for (const matchingIndex of matchingIndexes) {
      const block = blocks[matchingIndex]
      const closingText = block?.closingText
      if (closingText) {
        dependencies.assertTopicTextHasSubstantiveLeadingAnswerContent(
          closingText,
          'topic closing block paragraph',
        )
      }
      if (block?.text) {
        dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(
          block.text,
          'Topic closing block',
        )
      }
    }
    return consumeContiguousTopicSourceResponseText(
      blocks,
      matchingIndexes,
      `Multiple topic closing blocks matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedTopicClosingBlockIndexes,
      '\n\n',
    )
  }

  function consumeTopicParagraphSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
    rejectMultipleInferredTopicSummaries = false,
  ) {
    const paragraphs = dependencies.parseRequiredTopicSourceResponseParagraphs(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedTopicParagraphIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingTopicParagraphIndexes(
      paragraphs,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(`No topic paragraph matched ${label} in sourceResponse.`)
    }
    if (rejectMultipleInferredTopicSummaries) {
      for (const matchingIndex of matchingIndexes) {
        const text = paragraphs[matchingIndex]?.text
        if (text && dependencies.paragraphTextImpliesMultipleTopicSummaries(text)) {
          throw new AnswerInterpretationError(
            `Multiple topic paragraphs matched ${label} in sourceResponse.`,
          )
        }
      }
    }
    for (const matchingIndex of matchingIndexes) {
      const text = paragraphs[matchingIndex]?.text
      if (text) {
        dependencies.assertTopicTextHasSubstantiveLeadingAnswerContent(text, 'topic paragraph')
        dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(
          text,
          'Topic paragraph',
        )
      }
    }
    return consumeContiguousTopicSourceResponseText(
      paragraphs,
      matchingIndexes,
      `Multiple topic paragraphs matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedTopicParagraphIndexes,
      '\n\n',
      rejectMultipleInferredTopicSummaries,
    )
  }

  function consumeTopicMiddleBlockSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
    rejectMultipleInferredTopicSummaries = false,
  ) {
    dependencies.registerTopicAnchorCandidates(sourceResponseState, [candidates])
    const blocks = dependencies.parseRequiredTopicSourceResponseMiddleBlocks(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedTopicMiddleBlockIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingTopicBlockIndexes(
      blocks,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(
        `No topic middle block matched ${label} in sourceResponse.`,
      )
    }
    if (rejectMultipleInferredTopicSummaries) {
      for (const matchingIndex of matchingIndexes) {
        const anchorText = blocks[matchingIndex]?.anchorText
        if (
          anchorText &&
          dependencies.paragraphTextImpliesMultipleTopicSummaries(anchorText)
        ) {
          throw new AnswerInterpretationError(
            `Multiple topic middle blocks matched ${label} in sourceResponse.`,
          )
        }
      }
    }
    for (const matchingIndex of matchingIndexes) {
      const block = blocks[matchingIndex]
      const anchorText = block?.anchorText
      if (anchorText) {
        dependencies.assertTopicTextHasSubstantiveLeadingAnswerContent(
          anchorText,
          'topic middle block anchor paragraph',
        )
      }
      if (block?.text) {
        dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(
          block.text,
          'Topic middle block',
        )
      }
    }
    return consumeContiguousTopicSourceResponseText(
      blocks,
      matchingIndexes,
      `Multiple topic middle blocks matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedTopicMiddleBlockIndexes,
      '\n\n',
    )
  }

  function consumeTopicBlockSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
    rejectMultipleInferredTopicSummaries = false,
  ) {
    dependencies.registerTopicAnchorCandidates(sourceResponseState, [candidates])
    const blocks = dependencies.parseRequiredTopicSourceResponseBlocks(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes = sourceResponseState?.consumedTopicBlockIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingTopicBlockIndexes(
      blocks,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(`No topic block matched ${label} in sourceResponse.`)
    }
    if (rejectMultipleInferredTopicSummaries) {
      for (const matchingIndex of matchingIndexes) {
        const anchorText = blocks[matchingIndex]?.anchorText
        if (
          anchorText &&
          dependencies.paragraphTextImpliesMultipleTopicSummaries(anchorText)
        ) {
          throw new AnswerInterpretationError(
            `Multiple topic blocks matched ${label} in sourceResponse.`,
          )
        }
      }
    }
    for (const matchingIndex of matchingIndexes) {
      const block = blocks[matchingIndex]
      const anchorText = block?.anchorText
      if (anchorText) {
        dependencies.assertTopicTextHasSubstantiveLeadingAnswerContent(
          anchorText,
          'topic block anchor paragraph',
        )
      }
      if (block?.text) {
        dependencies.assertTopicAnswerTextDoesNotContainQuestionAuthority(
          block.text,
          'Topic block',
        )
      }
    }
    return consumeContiguousTopicSourceResponseText(
      blocks,
      matchingIndexes,
      `Multiple topic blocks matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedTopicBlockIndexes,
      '\n\n',
    )
  }

  return {
    consumeTopicBlockSourceResponseSection,
    consumeTopicClauseSourceResponseSection,
    consumeTopicClosingBlockSourceResponseSection,
    consumeTopicClosingSpanSourceResponseSection,
    consumeTopicMiddleBlockSourceResponseSection,
    consumeTopicMiddleSpanSourceResponseSection,
    consumeTopicParagraphSourceResponseSection,
    consumeTopicSentenceSourceResponseSection,
    consumeTopicSpanSourceResponseSection,
  }
}
