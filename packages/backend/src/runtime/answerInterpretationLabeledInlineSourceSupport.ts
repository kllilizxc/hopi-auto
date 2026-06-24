import { AnswerInterpretationError } from './answerInterpretationErrors'
import { normalizeSourceResponseLabel } from './answerInterpretationStrings'
import type {
  InterpretedSourceResponseState,
  LabeledSourceResponseSection,
} from './answerInterpretationTypes'

interface LabeledInlineSourceSupportDependencies {
  extractInferredTopicSummaries: (text: string) => string[]
  extractPrefixedTopicSummary: (text: string) => string | undefined
  extractQuestionAuthorityTextsFromText: (text: string) => string[]
  formatQuotedValueList: (values: string[]) => string
  inferComparableExplicitLabelSummary: (label: string) => string | undefined
  isQuestionSourceResponseSentence: (text: string) => boolean
  normalizeExtractedTopicSummary: (
    summary: string,
    stripLeadingArticle?: boolean,
  ) => string | undefined
  normalizeExplicitTopicOrQuestionUnitText: (text: string) => string
  parseTopicSourceResponseSentences: (sourceResponse: string) => Array<{ text: string }>
  resolveCanonicalQuestionAnchorMatch: (
    sourceResponse: string,
    tokens: Array<{ normalizedText: string; start: number; end: number }>,
    startTokenIndex: number,
  ) => { canonicalPrompt: string; endOriginal: number } | undefined
  startsWithNonPunctuatedWhClauseDeclarative: (text: string) => boolean
  stripLeadingPresentationListMarkers: (text: string) => string
  tokenizeEmbeddedMatchingRunSourceResponse: (
    sourceResponse: string,
  ) => Array<{ normalizedText: string; start: number; end: number }>
  topicPredicateIncludesSubstantiveAnswerContent: (answer: string) => boolean
  topicSummaryVerbPattern: string
}

export function createAnswerInterpretationLabeledInlineSourceSupport(
  dependencies: LabeledInlineSourceSupportDependencies,
) {
  function parseRequiredLabeledSourceResponseSections(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.labeledSections) {
      return sourceResponseState.labeledSections
    }
    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat labeled_sections requires sourceResponse for ${label}.`,
      )
    }

    const sections = parseLabeledSourceResponseSections(shared)
    if (sourceResponseState) {
      sourceResponseState.labeledSections = sections
    }
    return sections
  }

  function parseRequiredInlineTopicSections(
    sourceResponse: string | undefined,
    label: string,
    sourceResponseState?: InterpretedSourceResponseState,
  ) {
    if (sourceResponseState?.inlineTopics) {
      return sourceResponseState.inlineTopics
    }

    const shared = sourceResponse?.trim()
    if (!shared) {
      throw new AnswerInterpretationError(
        `sourceResponseFormat inline_topics requires sourceResponse for ${label}.`,
      )
    }

    const sections = parseInlineTopicSections(shared)
    if (sourceResponseState) {
      sourceResponseState.inlineTopics = sections
    }
    return sections
  }

  function parseLabeledSourceResponseSections(sourceResponse: string) {
    const sectionsByLabel = new Map<string, LabeledSourceResponseSection>()
    for (const [lineIndex, line] of sourceResponse.split(/\r?\n/).entries()) {
      const trimmed = dependencies.stripLeadingPresentationListMarkers(line.trim())
      if (!trimmed) {
        continue
      }
      const match = /^(?:[-*•]\s*)?([^:：]+?)\s*[:：]\s*(.+)$/.exec(trimmed)
      if (!match) {
        continue
      }
      const rawLabel = match[1]?.trim()
      const value = dependencies.normalizeExplicitTopicOrQuestionUnitText(match[2] ?? '')
      if (!rawLabel || !value) {
        continue
      }
      assertExplicitLabelTextDoesNotContainAuthority(rawLabel, 'Labeled section label')
      if (labeledSectionValueStartsWithNestedSameSummaryLabel(rawLabel, value)) {
        throw new AnswerInterpretationError(
          `Labeled section "${rawLabel}" in sourceResponse included another labeled section inside its value.`,
        )
      }
      if (labeledSectionValueContainsAdditionalLabeledSentence(value)) {
        throw new AnswerInterpretationError(
          `Labeled section "${rawLabel}" in sourceResponse included another labeled section inside its value.`,
        )
      }
      const normalized = normalizeSourceResponseLabel(rawLabel)
      if (sectionsByLabel.has(normalized)) {
        throw new AnswerInterpretationError(
          `Duplicate labeled section "${rawLabel}" in sourceResponse.`,
        )
      }
      sectionsByLabel.set(normalized, {
        label: rawLabel,
        value,
        sourceLineIndex: lineIndex,
      })
    }
    return sectionsByLabel
  }

  function assertExplicitLabelTextDoesNotContainAuthority(label: string, unitLabel: string) {
    const questionAuthorities = dependencies.extractQuestionAuthorityTextsFromText(label)
    if (questionAuthorities.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} "${label}" in sourceResponse included question authority ${dependencies.formatQuotedValueList(questionAuthorities)} inside label text.`,
      )
    }

    const topicAuthorities = dependencies.extractInferredTopicSummaries(label)
    if (topicAuthorities.length > 0) {
      throw new AnswerInterpretationError(
        `${unitLabel} "${label}" in sourceResponse included topic authority for ${dependencies.formatQuotedValueList(topicAuthorities)} inside label text.`,
      )
    }

    const incompleteSummary = extractIncompleteLeadingTopicAuthoritySummary(label)
    if (!incompleteSummary) {
      return
    }

    throw new AnswerInterpretationError(
      `${unitLabel} "${label}" in sourceResponse included incomplete topic authority for ${dependencies.formatQuotedValueList([incompleteSummary])} inside label text.`,
    )
  }

  function extractIncompleteLeadingTopicAuthoritySummary(text: string) {
    const trimmed = dependencies.stripLeadingPresentationListMarkers(
      text.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (!trimmed) {
      return undefined
    }

    const groups = new RegExp(
      `^(?<label>.+?)\\s+(?<answer>${dependencies.topicSummaryVerbPattern}\\b.*)$`,
      'i',
    ).exec(trimmed)?.groups
    const label = groups?.label
    const answer = groups?.answer
    if (
      !label ||
      answer === undefined ||
      dependencies.topicPredicateIncludesSubstantiveAnswerContent(answer)
    ) {
      return undefined
    }

    return dependencies.normalizeExtractedTopicSummary(label, true)
  }

  function labeledSectionValueStartsWithNestedSameSummaryLabel(label: string, value: string) {
    const firstSentence = dependencies.parseTopicSourceResponseSentences(value)[0]?.text
    if (!firstSentence) {
      return false
    }

    const nested = parseInlineTopicClause(firstSentence)
    if (!nested) {
      return false
    }

    const expectedSummary = dependencies.inferComparableExplicitLabelSummary(label)
    const nestedSummary = dependencies.inferComparableExplicitLabelSummary(nested.label)
    if (!expectedSummary || !nestedSummary) {
      return false
    }

    return (
      normalizeSourceResponseLabel(expectedSummary) ===
      normalizeSourceResponseLabel(nestedSummary)
    )
  }

  function labeledSectionValueContainsAdditionalLabeledSentence(value: string) {
    const sentences = dependencies.parseTopicSourceResponseSentences(value)
    for (const sentence of sentences.slice(1)) {
      if (parseInlineTopicClause(sentence.text)) {
        return true
      }
    }
    return false
  }

  function parseInlineTopicSections(sourceResponse: string) {
    const sectionsByLabel = new Map<string, LabeledSourceResponseSection>()
    const clauses = splitInlineTopicClauses(sourceResponse)

    for (const [clauseIndex, clause] of clauses.entries()) {
      const parsed = parseInlineTopicClause(clause)
      if (!parsed) {
        continue
      }

      const trimmedClause = dependencies.stripLeadingPresentationListMarkers(
        clause.trim().replace(/^(?:and|but)\s+/i, ''),
      )
      if (inlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause)) {
        assertExplicitLabelTextDoesNotContainAuthority(parsed.label, 'Inline topic clause label')
      }
      const normalized = normalizeSourceResponseLabel(parsed.label)
      if (sectionsByLabel.has(normalized)) {
        throw new AnswerInterpretationError(
          `Duplicate inline topic clause "${parsed.label}" in sourceResponse.`,
        )
      }
      sectionsByLabel.set(normalized, {
        ...parsed,
        sourceClauseIndex: clauseIndex,
      })
    }

    return sectionsByLabel
  }

  function splitInlineTopicClauses(sourceResponse: string) {
    const rawClauses = sourceResponse
      .split(/(?:\r?\n+|;+\s*|；+\s*|(?<=[.?!。？！])\s+)/)
      .map((clause) => clause.trim())
      .filter(Boolean)

    const clauses: string[] = []
    for (const clause of rawClauses) {
      const previousClause = clauses.at(-1)
      if (previousClause && shouldMergeWithFollowingInlineTopicClause(previousClause)) {
        clauses[clauses.length - 1] = `${previousClause} ${clause}`.trim()
        continue
      }
      clauses.push(clause)
    }

    return clauses
  }

  function shouldMergeWithFollowingInlineTopicClause(clause: string) {
    const trimmed = dependencies.stripLeadingPresentationListMarkers(
      clause.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (!trimmed || /[.?!。？！]$/u.test(trimmed)) {
      return false
    }

    if (/^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*$/u.test(trimmed)) {
      return true
    }

    if (/^(?<label>.+?)\s+(?:-|－|–|—)\s*$/u.test(trimmed)) {
      return true
    }

    const verbal = new RegExp(
      `^(?<label>.+?)\\s+(?<answer>${dependencies.topicSummaryVerbPattern}\\b.*)$`,
      'i',
    ).exec(trimmed)?.groups

    return Boolean(
      verbal?.answer && !dependencies.topicPredicateIncludesSubstantiveAnswerContent(verbal.answer),
    )
  }

  function parseInlineTopicClause(clause: string): LabeledSourceResponseSection | undefined {
    const trimmed = dependencies.stripLeadingPresentationListMarkers(
      clause.trim().replace(/^(?:and|but)\s+/i, ''),
    )
    if (!trimmed) {
      return undefined
    }
    if (dependencies.extractPrefixedTopicSummary(trimmed)) {
      return undefined
    }

    const punctuated = /^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/.exec(
      trimmed,
    )?.groups
    if (punctuated?.label && punctuated.answer) {
      return {
        label: punctuated.label.trim(),
        value: normalizeInlineTopicAnswer(punctuated.answer),
      }
    }

    const dashed = /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/.exec(trimmed)?.groups
    if (dashed?.label && dashed.answer) {
      return {
        label: dashed.label.trim(),
        value: normalizeInlineTopicAnswer(dashed.answer),
      }
    }

    if (
      dependencies.isQuestionSourceResponseSentence(trimmed) ||
      dependencies.startsWithNonPunctuatedWhClauseDeclarative(trimmed) ||
      dependencies.resolveCanonicalQuestionAnchorMatch(
        trimmed,
        dependencies.tokenizeEmbeddedMatchingRunSourceResponse(trimmed),
        0,
      )
    ) {
      return undefined
    }

    const verbal = new RegExp(
      `^(?<label>.+?)\\s+(?<answer>${dependencies.topicSummaryVerbPattern}\\b.+)$`,
      'i',
    ).exec(trimmed)?.groups
    if (
      verbal?.label &&
      verbal.answer &&
      dependencies.topicPredicateIncludesSubstantiveAnswerContent(verbal.answer)
    ) {
      return {
        label: verbal.label.trim(),
        value: normalizeInlineTopicAnswer(verbal.answer),
      }
    }

    return undefined
  }

  function inlineTopicClauseUsesExplicitLabelValueSeparator(trimmedClause: string) {
    return (
      /^(?<label>.+?)\s*(?::|：|=|＝|->|－>|→)\s*(?<answer>.+)$/u.test(trimmedClause) ||
      /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/.test(trimmedClause)
    )
  }

  function inlineTopicClauseUsesNonLabeledSectionExplicitLabelValueSeparator(
    trimmedClause: string,
  ) {
    return (
      /^(?<label>.+?)\s*(?:=|＝|->|－>|→)\s*(?<answer>.+)$/u.test(trimmedClause) ||
      /^(?<label>.+?)\s+(?:-|－|–|—)\s+(?<answer>.+)$/.test(trimmedClause)
    )
  }

  function normalizeInlineTopicAnswer(value: string) {
    const stripped = dependencies.normalizeExplicitTopicOrQuestionUnitText(value).replace(
      /^(?:should|will|must|can|could|would|is|are|was|were)\b\s*/i,
      '',
    )

    if (stripped.length === 0) {
      return stripped
    }

    return `${stripped.slice(0, 1).toUpperCase()}${stripped.slice(1)}`
  }

  return {
    assertExplicitLabelTextDoesNotContainAuthority,
    inlineTopicClauseUsesExplicitLabelValueSeparator,
    inlineTopicClauseUsesNonLabeledSectionExplicitLabelValueSeparator,
    normalizeInlineTopicAnswer,
    parseInlineTopicClause,
    parseRequiredInlineTopicSections,
    parseRequiredLabeledSourceResponseSections,
    splitInlineTopicClauses,
  }
}
