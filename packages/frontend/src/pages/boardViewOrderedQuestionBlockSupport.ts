import type { GoalSourceResponseFormat } from '../lib/api'
import { stripFrontendPresentationListMarkers } from './boardViewInlineTopicSupport'

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function parseFrontendOrderedSourceResponseItems(sourceResponse: string) {
  const items: string[] = []
  for (const line of sourceResponse.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const value = stripFrontendPresentationListMarkers(trimmed)
    if (!value) {
      continue
    }
    items.push(value)
  }
  return items
}

function normalizeFrontendOrderedSourceResponseBlock(block: string) {
  const trimmed = block.trim()
  if (!trimmed) {
    return trimmed
  }

  const paragraphs = trimmed
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => stripFrontendPresentationListMarkers(paragraph.trim()))
    .filter(Boolean)
  if (paragraphs.length === 0) {
    return trimmed
  }

  return paragraphs.join('\n\n')
}

function parseFrontendOrderedSourceResponseBlocks(sourceResponse: string) {
  return sourceResponse
    .split(/\r?\n\s*\r?\n\s*\r?\n+/)
    .map((block) => normalizeFrontendOrderedSourceResponseBlock(block))
    .filter(Boolean)
}

function frontendSourceResponseHasMultipleMarkedOrderedLines(sourceResponse: string | undefined) {
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
    if (stripFrontendPresentationListMarkers(trimmed) !== trimmed) {
      markedLineCount += 1
      if (markedLineCount > 1) {
        return true
      }
    }
  }

  return false
}

export function listOrderedSourceResponseStructureIssues({
  format,
  sourceResponse,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
}) {
  if (format !== 'ordered_blocks') {
    return [] as string[]
  }

  const normalizedSourceResponse = normalizeOptionalString(sourceResponse) ?? ''
  if (!normalizedSourceResponse) {
    return [] as string[]
  }

  const blocks = parseFrontendOrderedSourceResponseBlocks(normalizedSourceResponse)
  if (
    blocks.length === 1 &&
    frontendSourceResponseHasMultipleMarkedOrderedLines(normalizedSourceResponse)
  ) {
    return [
      'sourceResponseFormat ordered_blocks rejected sourceResponse because it collapsed multiple ordered item lines into one ordered block.',
    ]
  }

  return [] as string[]
}

export function listOrderedSourceResponseUnconsumedIssues({
  format,
  sourceResponse,
  explicitDecisionAnswerCount = 0,
  explicitPlanningAnswerCount = 0,
  explicitDecisionKeys = [],
  inferOpenDecisions = false,
  inferDecisionTopics = false,
  inferRemainingAnswers = false,
  openDecisionKeys = [],
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  explicitDecisionAnswerCount?: number
  explicitPlanningAnswerCount?: number
  explicitDecisionKeys?: string[]
  inferOpenDecisions?: boolean
  inferDecisionTopics?: boolean
  inferRemainingAnswers?: boolean
  openDecisionKeys?: string[]
}) {
  if (format !== 'ordered_items' && format !== 'ordered_blocks') {
    return [] as string[]
  }

  const normalizedSourceResponse = normalizeOptionalString(sourceResponse) ?? ''
  if (!normalizedSourceResponse) {
    return [] as string[]
  }

  if (
    format === 'ordered_blocks' &&
    listOrderedSourceResponseStructureIssues({
      format,
      sourceResponse: normalizedSourceResponse,
    }).length > 0
  ) {
    return [] as string[]
  }

  const unitCount =
    format === 'ordered_items'
      ? parseFrontendOrderedSourceResponseItems(normalizedSourceResponse).length
      : parseFrontendOrderedSourceResponseBlocks(normalizedSourceResponse).length
  if (unitCount === 0) {
    return [] as string[]
  }

  const normalizedOpenDecisionKeys = new Set(
    openDecisionKeys.map((value) => value.trim()).filter((value) => value.length > 0),
  )
  const matchedOpenDecisionKeys = new Set(
    explicitDecisionKeys
      .map((value) => value.trim())
      .filter((value) => normalizedOpenDecisionKeys.has(value)),
  )
  const inferredOpenDecisionCount = inferOpenDecisions
    ? Math.max(0, normalizedOpenDecisionKeys.size - matchedOpenDecisionKeys.size)
    : 0
  const expectedConsumerCount =
    explicitDecisionAnswerCount + explicitPlanningAnswerCount + inferredOpenDecisionCount

  void inferDecisionTopics
  void inferRemainingAnswers

  if (expectedConsumerCount <= 0 || unitCount <= expectedConsumerCount) {
    return [] as string[]
  }

  const remainingCount = unitCount - expectedConsumerCount
  const unitLabel = format === 'ordered_items' ? 'ordered items' : 'ordered blocks'
  return [
    `sourceResponseFormat ${format} rejected sourceResponse because it left ${remainingCount} unconsumed ${unitLabel}.`,
  ]
}

type FrontendQuestionSourceResponseBlock = {
  question: string
  answer: string
}

function stripLeadingFrontendQuestionPromptConjunction(question: string) {
  return stripFrontendPresentationListMarkers(question.trim().replace(/^(?:and|but)\s+/i, ''))
}

function normalizeFrontendExplicitQuestionSurfaceText(question: string) {
  if (!question) {
    return question
  }

  return `${question.slice(0, 1).toUpperCase()}${question.slice(1)}`
}

function inferFrontendCanonicalQuestionPrompt(question: string) {
  const trimmed = stripLeadingFrontendQuestionPromptConjunction(question)
    .replace(/[?？.!。！]+$/u, '')
    .trim()
  const subject = /^what should\s+(?<subject>.+?)\s+be$/i.exec(trimmed)?.groups?.subject
  if (!subject) {
    return undefined
  }

  return normalizeFrontendExplicitQuestionSurfaceText(`What should ${subject.trim()} be?`)
}

function isFrontendQuestionSourceResponseParagraph(paragraph: string) {
  const trimmed = stripLeadingFrontendQuestionPromptConjunction(paragraph)
  return /[?？]\s*$/u.test(trimmed) || Boolean(inferFrontendCanonicalQuestionPrompt(trimmed))
}

function normalizeFrontendQuestionSourceResponsePrompt(question: string) {
  const trimmed = stripLeadingFrontendQuestionPromptConjunction(question)
  if (!trimmed) {
    return trimmed
  }
  if (/[?？]\s*$/u.test(trimmed)) {
    return normalizeFrontendExplicitQuestionSurfaceText(trimmed)
  }

  return (
    inferFrontendCanonicalQuestionPrompt(trimmed) ??
    normalizeFrontendExplicitQuestionSurfaceText(trimmed)
  )
}

function parseFrontendQuestionSourceResponseBlocks(sourceResponse: string) {
  const paragraphs = sourceResponse
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) => stripFrontendPresentationListMarkers(paragraph.trim()))
    .filter(Boolean)
  const blocks: FrontendQuestionSourceResponseBlock[] = []
  let currentQuestion: string | undefined
  let answerParagraphs: string[] = []

  for (const paragraph of paragraphs) {
    if (isFrontendQuestionSourceResponseParagraph(paragraph)) {
      const questionParagraph = normalizeFrontendQuestionSourceResponsePrompt(paragraph)
      if (currentQuestion) {
        if (answerParagraphs.length === 0) {
          throw new Error(
            `Question block "${currentQuestion}" in sourceResponse did not include an answer block.`,
          )
        }
        blocks.push({
          question: currentQuestion,
          answer: answerParagraphs.join('\n\n'),
        })
      } else if (answerParagraphs.length > 0) {
        throw new Error(
          'sourceResponseFormat question_blocks requires sourceResponse to start with a question block.',
        )
      }
      currentQuestion = questionParagraph
      answerParagraphs = []
      continue
    }

    if (!currentQuestion) {
      throw new Error(
        'sourceResponseFormat question_blocks requires sourceResponse to start with a question block.',
      )
    }
    answerParagraphs.push(paragraph)
  }

  if (!currentQuestion) {
    return blocks
  }
  if (answerParagraphs.length === 0) {
    throw new Error(
      `Question block "${currentQuestion}" in sourceResponse did not include an answer block.`,
    )
  }

  blocks.push({
    question: currentQuestion,
    answer: answerParagraphs.join('\n\n'),
  })
  return blocks
}

export function listQuestionBlockStructureIssues({
  format,
  sourceResponse,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
}) {
  if (format !== 'question_blocks') {
    return [] as string[]
  }

  const normalizedSourceResponse = normalizeOptionalString(sourceResponse) ?? ''
  if (!normalizedSourceResponse) {
    return [] as string[]
  }

  try {
    parseFrontendQuestionSourceResponseBlocks(normalizedSourceResponse)
    return [] as string[]
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}

export function listQuestionBlockUnconsumedIssues({
  format,
  sourceResponse,
  explicitDecisionAnswerCount = 0,
  explicitPlanningAnswerCount = 0,
  explicitDecisionKeys = [],
  inferOpenDecisions = false,
  inferDecisionTopics = false,
  inferRemainingAnswers = false,
  openDecisionKeys = [],
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  explicitDecisionAnswerCount?: number
  explicitPlanningAnswerCount?: number
  explicitDecisionKeys?: string[]
  inferOpenDecisions?: boolean
  inferDecisionTopics?: boolean
  inferRemainingAnswers?: boolean
  openDecisionKeys?: string[]
}) {
  if (format !== 'question_blocks') {
    return [] as string[]
  }

  const normalizedSourceResponse = normalizeOptionalString(sourceResponse) ?? ''
  if (!normalizedSourceResponse) {
    return [] as string[]
  }

  if (
    listQuestionBlockStructureIssues({
      format,
      sourceResponse: normalizedSourceResponse,
    }).length > 0
  ) {
    return [] as string[]
  }

  const blockCount = parseFrontendQuestionSourceResponseBlocks(normalizedSourceResponse).length
  if (blockCount === 0) {
    return [] as string[]
  }

  const normalizedOpenDecisionKeys = new Set(
    openDecisionKeys.map((value) => value.trim()).filter((value) => value.length > 0),
  )
  const matchedOpenDecisionKeys = new Set(
    explicitDecisionKeys
      .map((value) => value.trim())
      .filter((value) => normalizedOpenDecisionKeys.has(value)),
  )
  const inferredOpenDecisionCount = inferOpenDecisions
    ? Math.max(0, normalizedOpenDecisionKeys.size - matchedOpenDecisionKeys.size)
    : 0
  const expectedConsumerCount =
    explicitDecisionAnswerCount + explicitPlanningAnswerCount + inferredOpenDecisionCount

  void inferDecisionTopics
  void inferRemainingAnswers

  if (expectedConsumerCount <= 0 || blockCount <= expectedConsumerCount) {
    return [] as string[]
  }

  return [
    `sourceResponseFormat question_blocks rejected sourceResponse because it left ${blockCount - expectedConsumerCount} unconsumed question blocks.`,
  ]
}
