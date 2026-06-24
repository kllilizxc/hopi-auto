import { AnswerInterpretationError } from './answerInterpretationErrors'
import { normalizeSourceResponseLabel } from './answerInterpretationStrings'
import type {
  InterpretedSourceResponseState,
  LabeledSourceResponseSection,
  QuestionSourceResponseBlock,
  QuestionSourceResponseClosingBlock,
  QuestionSourceResponseClosingSpan,
  QuestionSourceResponseSpan,
} from './answerInterpretationTypes'

interface SourceResponseSectionSupportDependencies {
  findMatchingQuestionBlockIndexes: (
    blocks: QuestionSourceResponseBlock[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  findMatchingQuestionClosingBlockIndexes: (
    blocks: QuestionSourceResponseClosingBlock[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  findMatchingQuestionClosingSpanIndexes: (
    spans: QuestionSourceResponseClosingSpan[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  findMatchingQuestionSpanIndexes: (
    spans: QuestionSourceResponseSpan[],
    candidates: string[],
    consumedIndexes?: Set<number>,
  ) => number[]
  parseRequiredQuestionSourceResponseBlocks: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => QuestionSourceResponseBlock[]
  parseRequiredQuestionSourceResponseClauses: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => QuestionSourceResponseSpan[]
  parseRequiredQuestionSourceResponseClosingBlocks: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => QuestionSourceResponseClosingBlock[]
  parseRequiredQuestionSourceResponseClosingSpans: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => QuestionSourceResponseClosingSpan[]
  parseRequiredQuestionSourceResponseMiddleBlocks: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => QuestionSourceResponseBlock[]
  parseRequiredQuestionSourceResponseMiddleSpans: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => QuestionSourceResponseSpan[]
  parseRequiredQuestionSourceResponseSpans: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) => QuestionSourceResponseSpan[]
}

export function createAnswerInterpretationSourceResponseSectionSupport(
  dependencies: SourceResponseSectionSupportDependencies,
) {
  function findLabeledSourceResponseSectionEntry(
    sectionsByLabel: Map<string, LabeledSourceResponseSection>,
    candidates: string[],
    consumedLabels?: Set<string>,
  ) {
    for (const candidate of candidates) {
      const normalizedLabel = normalizeSourceResponseLabel(candidate)
      const match = sectionsByLabel.get(normalizedLabel)
      if (match) {
        consumedLabels?.add(normalizedLabel)
        return match
      }
    }
    return undefined
  }

  function resolveContiguousMatchingIndexes(
    matchingIndexes: number[],
    multipleMatchErrorMessage: string,
  ) {
    for (let index = 1; index < matchingIndexes.length; index += 1) {
      const previousMatch = matchingIndexes[index - 1]
      const currentMatch = matchingIndexes[index]
      if (
        previousMatch === undefined ||
        currentMatch === undefined ||
        currentMatch !== previousMatch + 1
      ) {
        throw new AnswerInterpretationError(multipleMatchErrorMessage)
      }
    }

    return matchingIndexes
  }

  function markConsumedMatchingIndexes(
    consumedIndexes: Set<number> | undefined,
    matchingIndexes: number[],
  ) {
    if (!consumedIndexes) {
      return
    }

    for (const matchingIndex of matchingIndexes) {
      consumedIndexes.add(matchingIndex)
    }
  }

  function consumeContiguousQuestionSourceResponseMatch<
    T extends {
      question: string
      normalizedQuestionText: string
      normalizedQuestionCoreText: string
      answer: string
    },
  >(
    matches: T[],
    matchingIndexes: number[],
    multipleMatchErrorMessage: string,
    consumedIndexes: Set<number> | undefined,
    joiner: string,
  ) {
    const contiguousMatchingIndexes = resolveContiguousMatchingIndexes(
      matchingIndexes,
      multipleMatchErrorMessage,
    )
    const firstMatchIndex = contiguousMatchingIndexes[0]
    if (firstMatchIndex === undefined) {
      return undefined
    }

    markConsumedMatchingIndexes(consumedIndexes, contiguousMatchingIndexes)
    const firstMatch = matches[firstMatchIndex]
    if (!firstMatch) {
      return undefined
    }
    if (contiguousMatchingIndexes.length === 1) {
      return firstMatch
    }

    return {
      ...firstMatch,
      answer: contiguousMatchingIndexes
        .map((matchingIndex) => matches[matchingIndex]?.answer)
        .filter((answer): answer is string => answer !== undefined)
        .join(joiner),
    }
  }

  function consumeQuestionBlockSourceResponseMatch(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const blocks = dependencies.parseRequiredQuestionSourceResponseBlocks(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes = sourceResponseState?.consumedQuestionBlockIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingQuestionBlockIndexes(
      blocks,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(`No question block matched ${label} in sourceResponse.`)
    }
    return consumeContiguousQuestionSourceResponseMatch(
      blocks,
      matchingIndexes,
      `Multiple question blocks matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedQuestionBlockIndexes,
      '\n\n',
    )
  }

  function consumeQuestionClauseSourceResponseMatch(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const clauses = dependencies.parseRequiredQuestionSourceResponseClauses(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedQuestionClauseIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingQuestionSpanIndexes(
      clauses,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(`No question clause matched ${label} in sourceResponse.`)
    }
    return consumeContiguousQuestionSourceResponseMatch(
      clauses,
      matchingIndexes,
      `Multiple question clauses matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedQuestionClauseIndexes,
      ' ',
    )
  }

  function consumeQuestionSpanSourceResponseMatch(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const spans = dependencies.parseRequiredQuestionSourceResponseSpans(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes = sourceResponseState?.consumedQuestionSpanIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingQuestionSpanIndexes(
      spans,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(`No question span matched ${label} in sourceResponse.`)
    }
    return consumeContiguousQuestionSourceResponseMatch(
      spans,
      matchingIndexes,
      `Multiple question spans matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedQuestionSpanIndexes,
      ' ',
    )
  }

  function consumeQuestionMiddleSpanSourceResponseMatch(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const spans = dependencies.parseRequiredQuestionSourceResponseMiddleSpans(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedQuestionMiddleSpanIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingQuestionSpanIndexes(
      spans,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(
        `No question middle span matched ${label} in sourceResponse.`,
      )
    }
    return consumeContiguousQuestionSourceResponseMatch(
      spans,
      matchingIndexes,
      `Multiple question middle spans matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedQuestionMiddleSpanIndexes,
      ' ',
    )
  }

  function consumeQuestionClosingSpanSourceResponseMatch(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const spans = dependencies.parseRequiredQuestionSourceResponseClosingSpans(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedQuestionClosingSpanIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingQuestionClosingSpanIndexes(
      spans,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(
        `No question closing span matched ${label} in sourceResponse.`,
      )
    }
    return consumeContiguousQuestionSourceResponseMatch(
      spans,
      matchingIndexes,
      `Multiple question closing spans matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedQuestionClosingSpanIndexes,
      ' ',
    )
  }

  function consumeQuestionClosingBlockSourceResponseMatch(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const blocks = dependencies.parseRequiredQuestionSourceResponseClosingBlocks(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedQuestionClosingBlockIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingQuestionClosingBlockIndexes(
      blocks,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(
        `No question closing block matched ${label} in sourceResponse.`,
      )
    }
    return consumeContiguousQuestionSourceResponseMatch(
      blocks,
      matchingIndexes,
      `Multiple question closing blocks matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedQuestionClosingBlockIndexes,
      '\n\n',
    )
  }

  function consumeQuestionMiddleBlockSourceResponseMatch(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const blocks = dependencies.parseRequiredQuestionSourceResponseMiddleBlocks(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const consumedIndexes =
      sourceResponseState?.consumedQuestionMiddleBlockIndexes ?? new Set<number>()
    const matchingIndexes = dependencies.findMatchingQuestionBlockIndexes(
      blocks,
      candidates,
      consumedIndexes,
    )

    if (matchingIndexes.length === 0) {
      if (!required) {
        return undefined
      }
      throw new AnswerInterpretationError(
        `No question middle block matched ${label} in sourceResponse.`,
      )
    }
    return consumeContiguousQuestionSourceResponseMatch(
      blocks,
      matchingIndexes,
      `Multiple question middle blocks matched ${label} in sourceResponse.`,
      sourceResponseState?.consumedQuestionMiddleBlockIndexes,
      '\n\n',
    )
  }

  function consumeQuestionBlockSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const match = consumeQuestionBlockSourceResponseMatch(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      required,
    )
    return match?.answer
  }

  function consumeQuestionSpanSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const match = consumeQuestionSpanSourceResponseMatch(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      required,
    )
    return match?.answer
  }

  function consumeQuestionClauseSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const match = consumeQuestionClauseSourceResponseMatch(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      required,
    )
    return match?.answer
  }

  function consumeQuestionMiddleSpanSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const match = consumeQuestionMiddleSpanSourceResponseMatch(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      required,
    )
    return match?.answer
  }

  function consumeQuestionClosingSpanSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const match = consumeQuestionClosingSpanSourceResponseMatch(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      required,
    )
    return match?.answer
  }

  function consumeQuestionClosingBlockSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const match = consumeQuestionClosingBlockSourceResponseMatch(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      required,
    )
    return match?.answer
  }

  function consumeQuestionMiddleBlockSourceResponseSection(
    sourceResponse: string | undefined,
    candidates: string[],
    label: string,
    sourceResponseState: InterpretedSourceResponseState | undefined,
    required: boolean,
  ) {
    const match = consumeQuestionMiddleBlockSourceResponseMatch(
      sourceResponse,
      candidates,
      label,
      sourceResponseState,
      required,
    )
    return match?.answer
  }

  return {
    consumeQuestionBlockSourceResponseMatch,
    consumeQuestionBlockSourceResponseSection,
    consumeQuestionClauseSourceResponseMatch,
    consumeQuestionClauseSourceResponseSection,
    consumeQuestionClosingBlockSourceResponseMatch,
    consumeQuestionClosingBlockSourceResponseSection,
    consumeQuestionClosingSpanSourceResponseMatch,
    consumeQuestionClosingSpanSourceResponseSection,
    consumeQuestionMiddleBlockSourceResponseMatch,
    consumeQuestionMiddleBlockSourceResponseSection,
    consumeQuestionMiddleSpanSourceResponseMatch,
    consumeQuestionMiddleSpanSourceResponseSection,
    consumeQuestionSpanSourceResponseMatch,
    consumeQuestionSpanSourceResponseSection,
    findLabeledSourceResponseSectionEntry,
    markConsumedMatchingIndexes,
    resolveContiguousMatchingIndexes,
  }
}
