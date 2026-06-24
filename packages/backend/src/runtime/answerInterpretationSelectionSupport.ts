import { AnswerInterpretationError } from './answerInterpretationErrors'
import type {
  LabeledSourceResponseSection,
  MatchingSourceResponseRun,
} from './answerInterpretationTypes'

export function resolveIndexedValue<T>(input: {
  values: T[]
  index: number
  missingMessage: string
  onConsume?: (nextIndex: number) => void
}) {
  const value = input.values[input.index]
  if (value === undefined) {
    throw new AnswerInterpretationError(input.missingMessage)
  }

  input.onConsume?.(input.index + 1)
  return value
}

export function resolveSingleMatchingValue<T>(input: {
  items: T[]
  missingMessage: string
  multipleMessage: string
  matches: (item: T, index: number) => boolean
  valueSelector: (item: T) => string
  onConsume?: (index: number) => void
}) {
  let matchingIndex: number | undefined

  for (const [index, item] of input.items.entries()) {
    if (!input.matches(item, index)) {
      continue
    }
    if (matchingIndex !== undefined) {
      throw new AnswerInterpretationError(input.multipleMessage)
    }
    matchingIndex = index
  }

  if (matchingIndex === undefined) {
    throw new AnswerInterpretationError(input.missingMessage)
  }

  const matchingItem = input.items[matchingIndex]
  if (matchingItem === undefined) {
    throw new AnswerInterpretationError(input.missingMessage)
  }

  input.onConsume?.(matchingIndex)
  return input.valueSelector(matchingItem)
}

export function resolveContiguousMatchedValues<T>(input: {
  items: T[]
  matchingIndexes: number[]
  missingMessage: string
  multipleMessage: string
  onConsume?: (index: number) => void
}) {
  if (input.matchingIndexes.length === 0) {
    throw new AnswerInterpretationError(input.missingMessage)
  }

  for (let index = 1; index < input.matchingIndexes.length; index += 1) {
    const previousIndex = input.matchingIndexes[index - 1]
    const currentIndex = input.matchingIndexes[index]
    if (previousIndex === undefined || currentIndex === undefined) {
      throw new AnswerInterpretationError(input.multipleMessage)
    }
    if (currentIndex !== previousIndex + 1) {
      throw new AnswerInterpretationError(input.multipleMessage)
    }
  }

  return input.matchingIndexes.map((index) => {
    const matchingItem = input.items[index]
    if (matchingItem === undefined) {
      throw new AnswerInterpretationError(input.missingMessage)
    }

    input.onConsume?.(index)
    return matchingItem
  })
}

export function resolveIndexedParsedValue<T, TState>(input: {
  sourceResponse: string | undefined
  label: string
  parseValues: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: TState,
  ) => T[]
  sourceResponseState?: TState
  index: number
  missingMessage: string
  onConsume?: (nextIndex: number) => void
}) {
  const values = input.parseValues(input.sourceResponse, input.label, input.sourceResponseState)
  return resolveIndexedValue({
    values,
    index: input.index,
    missingMessage: input.missingMessage,
    onConsume: input.onConsume,
  })
}

export function resolveMatchingRunText(input: {
  runs: MatchingSourceResponseRun[]
  candidateGroupIndex: number
  consumedIndexes: Set<number>
  missingMessage: string
  multipleMessage: string
  onConsume?: (index: number) => void
}) {
  return resolveSingleMatchingValue({
    items: input.runs,
    missingMessage: input.missingMessage,
    multipleMessage: input.multipleMessage,
    matches: (run, index) =>
      !input.consumedIndexes.has(index) && run.candidateGroupIndex === input.candidateGroupIndex,
    valueSelector: (run) => run.text,
    onConsume: input.onConsume,
  })
}

export function resolveStructuredSectionValue<TState>(input: {
  sourceResponse: string | undefined
  candidates: string[]
  label: string
  sourceResponseState?: TState
  parseSections: (
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: TState,
  ) => Map<string, LabeledSourceResponseSection>
  consumedLabels?: Set<string>
  findMatch: (
    sectionsByLabel: Map<string, LabeledSourceResponseSection>,
    candidates: string[],
    consumedLabels?: Set<string>,
  ) => LabeledSourceResponseSection | undefined
  assertMatch: (match: LabeledSourceResponseSection) => void
  missingMessage: string
}) {
  const sectionsByLabel = input.parseSections(
    input.sourceResponse,
    input.label,
    input.sourceResponseState,
  )
  const match = input.findMatch(sectionsByLabel, input.candidates, input.consumedLabels)
  if (!match) {
    throw new AnswerInterpretationError(input.missingMessage)
  }

  input.assertMatch(match)
  return match.value
}
