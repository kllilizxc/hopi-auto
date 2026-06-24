import type { ResolvedAnswerSourceEntry } from './answerInterpretationAnswerSourceSupport'
import { AnswerInterpretationError } from './answerInterpretationErrors'
import type { InterpretedSourceResponseState } from './answerInterpretationTypes'

interface OrderedPendingSourceSupportDependencies {
  normalizeExplicitTopicOrQuestionUnitText: (text: string) => string
  parseGenericPendingSourceResponseClauses: (sourceResponse: string) => string[]
  parseGenericPendingSourceResponseParagraphs: (sourceResponse: string) => string[]
  parseGenericPendingSourceResponseSentences: (sourceResponse: string) => string[]
  parsePendingSourceResponseConjunctions: (sourceResponse: string) => string[]
  stripLeadingPresentationListMarkers: (text: string) => string
}

export function createAnswerInterpretationOrderedPendingSourceSupport(
  dependencies: OrderedPendingSourceSupportDependencies,
) {
  function requireSourceResponse(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseFormat:
      | 'ordered_items'
      | 'ordered_blocks'
      | 'pending_clauses'
      | 'pending_paragraphs'
      | 'pending_sentences'
      | 'pending_conjunctions',
  ) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat ${sourceResponseFormat} requires sourceResponse for ${label}.`,
      )
    }
    return shared
  }

  function resolveOrderedSourceResponseItem(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const items = parseRequiredOrderedSourceResponseItems(sourceResponse, label, sourceResponseState)
    const nextIndex = sourceResponseState?.nextOrderedItemIndex ?? 0
    const nextItem = items[nextIndex]
    if (!nextItem) {
      throw new AnswerInterpretationError(
        `No ordered item remained for ${label} in sourceResponse.`,
      )
    }
    if (sourceResponseState) {
      sourceResponseState.nextOrderedItemIndex = nextIndex + 1
    }
    return nextItem
  }

  function resolveOrderedSourceResponseBlock(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    const blocks = parseRequiredOrderedSourceResponseBlocks(
      sourceResponse,
      label,
      sourceResponseState,
    )
    const nextIndex = sourceResponseState?.nextOrderedBlockIndex ?? 0
    const nextBlock = blocks[nextIndex]
    if (!nextBlock) {
      throw new AnswerInterpretationError(
        `No ordered block remained for ${label} in sourceResponse.`,
      )
    }
    if (sourceResponseState) {
      sourceResponseState.nextOrderedBlockIndex = nextIndex + 1
    }
    return nextBlock
  }

  function parseRequiredOrderedSourceResponseItems(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.orderedItems) {
      return sourceResponseState.orderedItems
    }

    const items = parseOrderedSourceResponseItems(
      requireSourceResponse(sourceResponse, label, 'ordered_items'),
    )
    if (sourceResponseState) {
      sourceResponseState.orderedItems = items
    }
    return items
  }

  function parseRequiredPendingSourceResponseClauses(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.pendingClauses) {
      return sourceResponseState.pendingClauses
    }

    const clauses = dependencies.parseGenericPendingSourceResponseClauses(
      requireSourceResponse(sourceResponse, label, 'pending_clauses'),
    )
    if (sourceResponseState) {
      sourceResponseState.pendingClauses = clauses
    }
    return clauses
  }

  function parseRequiredPendingSourceResponseParagraphs(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.pendingParagraphs) {
      return sourceResponseState.pendingParagraphs
    }

    const paragraphs = dependencies.parseGenericPendingSourceResponseParagraphs(
      requireSourceResponse(sourceResponse, label, 'pending_paragraphs'),
    )
    if (sourceResponseState) {
      sourceResponseState.pendingParagraphs = paragraphs
    }
    return paragraphs
  }

  function parseRequiredPendingSourceResponseSentences(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.pendingSentences) {
      return sourceResponseState.pendingSentences
    }

    const sentences = dependencies.parseGenericPendingSourceResponseSentences(
      requireSourceResponse(sourceResponse, label, 'pending_sentences'),
    )
    if (sourceResponseState) {
      sourceResponseState.pendingSentences = sentences
    }
    return sentences
  }

  function parseRequiredPendingSourceResponseConjunctions(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.pendingConjunctions) {
      return sourceResponseState.pendingConjunctions
    }

    const conjunctions = dependencies.parsePendingSourceResponseConjunctions(
      requireSourceResponse(sourceResponse, label, 'pending_conjunctions'),
    )
    if (sourceResponseState) {
      sourceResponseState.pendingConjunctions = conjunctions
    }
    return conjunctions
  }

  function parseRequiredPendingAnswerSourceEntries(
    pendingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.pendingAnswerSourceEntries) {
      return sourceResponseState.pendingAnswerSourceEntries
    }

    if (!pendingAnswerSourceEntries || pendingAnswerSourceEntries.length === 0) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat pending_answer_sources requires answerSources for ${label}.`,
      )
    }

    if (sourceResponseState) {
      sourceResponseState.pendingAnswerSourceEntries = pendingAnswerSourceEntries
    }
    return pendingAnswerSourceEntries
  }

  function parseRequiredMatchingAnswerSourceEntries(
    matchingAnswerSourceEntries: ResolvedAnswerSourceEntry[] | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.matchingAnswerSourceEntries) {
      return sourceResponseState.matchingAnswerSourceEntries
    }

    if (!matchingAnswerSourceEntries || matchingAnswerSourceEntries.length === 0) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat matching_answer_sources requires answerSources for ${label}.`,
      )
    }

    if (sourceResponseState) {
      sourceResponseState.matchingAnswerSourceEntries = matchingAnswerSourceEntries
    }
    return matchingAnswerSourceEntries
  }

  function parseRequiredOrderedSourceResponseBlocks(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.orderedBlocks) {
      return sourceResponseState.orderedBlocks
    }

    const shared = requireSourceResponse(sourceResponse, label, 'ordered_blocks')
    const blocks = parseOrderedSourceResponseBlocks(shared)
    assertOrderedBlocksDidNotCollapseMarkedOrderedItems(shared, blocks)
    if (sourceResponseState) {
      sourceResponseState.orderedBlocks = blocks
    }
    return blocks
  }

  function parseOrderedSourceResponseItems(sourceResponse: string) {
    const items: string[] = []
    for (const line of sourceResponse.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }
      const value = dependencies.stripLeadingPresentationListMarkers(trimmed)
      if (!value) {
        continue
      }
      items.push(value)
    }
    return items
  }

  function parseOrderedSourceResponseBlocks(sourceResponse: string) {
    return sourceResponse
      .split(/\r?\n\s*\r?\n\s*\r?\n+/)
      .map((block) => normalizeOrderedSourceResponseBlock(block))
      .filter(Boolean)
  }

  function sourceResponseHasMultipleMarkedOrderedLines(sourceResponse: string | undefined) {
    const shared = sourceResponse?.trim()
    if (!shared) {
      return false
    }

    let markedLineCount = 0
    for (const line of shared.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) {
        continue
      }
      if (dependencies.stripLeadingPresentationListMarkers(trimmed) !== trimmed) {
        markedLineCount += 1
        if (markedLineCount > 1) {
          return true
        }
      }
    }

    return false
  }

  function orderedBlocksCollapsedMarkedOrderedItems(
    sourceResponse: string | undefined,
    blocks: string[] | undefined,
  ) {
    return (blocks?.length ?? 0) === 1 && sourceResponseHasMultipleMarkedOrderedLines(sourceResponse)
  }

  function assertOrderedBlocksDidNotCollapseMarkedOrderedItems(
    sourceResponse: string | undefined,
    blocks: string[],
  ) {
    if (!orderedBlocksCollapsedMarkedOrderedItems(sourceResponse, blocks)) {
      return
    }

    throw new AnswerInterpretationError(
      'sourceResponseFormat ordered_blocks rejected sourceResponse because it collapsed multiple ordered item lines into one ordered block.',
    )
  }

  function normalizeOrderedSourceResponseBlock(block: string) {
    const trimmed = block.trim()
    if (!trimmed) {
      return trimmed
    }

    const paragraphs = trimmed
      .split(/\r?\n\s*\r?\n+/)
      .map((paragraph) => dependencies.normalizeExplicitTopicOrQuestionUnitText(paragraph))
      .filter(Boolean)
    if (paragraphs.length === 0) {
      return trimmed
    }

    return paragraphs.join('\n\n')
  }

  return {
    assertOrderedBlocksDidNotCollapseMarkedOrderedItems,
    orderedBlocksCollapsedMarkedOrderedItems,
    parseRequiredMatchingAnswerSourceEntries,
    parseRequiredOrderedSourceResponseBlocks,
    parseRequiredOrderedSourceResponseItems,
    parseRequiredPendingAnswerSourceEntries,
    parseRequiredPendingSourceResponseClauses,
    parseRequiredPendingSourceResponseConjunctions,
    parseRequiredPendingSourceResponseParagraphs,
    parseRequiredPendingSourceResponseSentences,
    resolveOrderedSourceResponseBlock,
    resolveOrderedSourceResponseItem,
  }
}
