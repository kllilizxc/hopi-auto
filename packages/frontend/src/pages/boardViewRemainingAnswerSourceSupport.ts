import type { GoalAnswerSourceInput, GoalDecision, GoalSourceResponseFormat } from '../lib/api'
import { ANSWER_SOURCE_ONLY_FORMATS } from './boardViewSourceResponseSupport'

function normalizeOptionalString(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function formatUsesAnswerSourceOnlyInterpretation(format: GoalSourceResponseFormat) {
  return ANSWER_SOURCE_ONLY_FORMATS.has(format)
}

function formatSupportsMixedDecisionTopicAndRemainingAnswerInference(
  format: GoalSourceResponseFormat,
) {
  return format === 'auto' || ANSWER_SOURCE_ONLY_FORMATS.has(format)
}

export function listMixedDecisionTopicAndRemainingAnswerIssues(
  format: GoalSourceResponseFormat,
  answerSources: GoalAnswerSourceInput[] | undefined,
  inferDecisionTopics: boolean,
  inferRemainingAnswers: boolean,
) {
  if (!inferDecisionTopics || !inferRemainingAnswers) {
    return []
  }

  const issues: string[] = []
  if (!formatSupportsMixedDecisionTopicAndRemainingAnswerInference(format)) {
    issues.push(
      'Infer decision topics plus infer remaining planner answers can only run through pending_answer_sources or matching_answer_sources.',
    )
  }

  if (!answerSources || answerSources.length === 0) {
    issues.push(
      'Infer decision topics plus infer remaining planner answers needs structured answer sources with explicit routing metadata.',
    )
    return issues
  }

  const invalidRouting = answerSources.some((answerSource) => {
    const route = answerSource.route
    const decisionKey = answerSource.decisionKey?.trim()
    const answerKey = answerSource.answerKey?.trim()

    if (decisionKey && answerKey) {
      return true
    }
    if (route === 'decision' && answerKey) {
      return true
    }
    if (route === 'planning' && decisionKey) {
      return true
    }
    return !route && !decisionKey && !answerKey
  })

  if (invalidRouting) {
    issues.push(
      'Each remaining answer source must carry non-conflicting explicit routing via route, decisionKey, or answerKey before infer decision topics can be combined with infer remaining planner answers.',
    )
  }

  return issues
}

export function formatWillUseAnswerSourceOnlyInterpretation(
  format: GoalSourceResponseFormat,
  sourceResponse: string | undefined,
  answerSources?: GoalAnswerSourceInput[],
) {
  if (!answerSources || answerSources.length === 0) {
    return false
  }

  if (formatUsesAnswerSourceOnlyInterpretation(format)) {
    return true
  }

  return format === 'auto' && !sourceResponse
}

function hasExactlyOneVisibleRemainingAnswerSourceMatchHint(matchHints?: string[]) {
  const uniqueHints = new Set(
    (matchHints ?? [])
      .map((matchHint) => matchHint.trim().toLowerCase())
      .filter((matchHint) => matchHint.length > 0),
  )
  return uniqueHints.size === 1
}

function hasStableRemainingAnswerSourceKeyAuthority(answerSourceKey?: string) {
  const trimmed = answerSourceKey?.trim()
  if (!trimmed) {
    return false
  }

  const stripped = trimmed.replace(/(?:[_-]+(?:answer|source))$/i, '').trim()
  return stripped.length > 0 && stripped !== trimmed
}

function hasVisibleRemainingAnswerSourceSummaryAuthority(entry: GoalAnswerSourceInput) {
  return Boolean(
    entry.summary?.trim() ||
      entry.prompt?.trim() ||
      entry.decisionKey?.trim() ||
      entry.summaryKey?.trim() ||
      hasExactlyOneVisibleRemainingAnswerSourceMatchHint(entry.matchHints) ||
      hasStableRemainingAnswerSourceKeyAuthority(entry.answerSourceKey),
  )
}

function listRemainingAnswerSourceSummaryAuthorityIssues(
  label: string,
  entries: GoalAnswerSourceInput[],
) {
  const issues: string[] = []

  entries.forEach((entry, index) => {
    if (hasVisibleRemainingAnswerSourceSummaryAuthority(entry)) {
      return
    }

    const entryLabel = entries.length === 1 ? label : `${label} entry ${index + 1}`
    issues.push(
      `${entryLabel} needs visible summary authority via summary, prompt, decisionKey, summaryKey, exactly one match hint, or stable answerSourceKey.`,
    )
  })

  return issues
}

export function resolveMixedRemainingAnswerSourceRoute(entry: GoalAnswerSourceInput) {
  const route = entry.route?.trim()
  const decisionKey = entry.decisionKey?.trim()
  const answerKey = entry.answerKey?.trim()

  if (route === 'decision' && !answerKey) {
    return 'decision' as const
  }
  if (route === 'planning' && !decisionKey) {
    return 'planning' as const
  }
  if (decisionKey && !answerKey) {
    return 'decision' as const
  }
  if (answerKey && !decisionKey) {
    return 'planning' as const
  }

  return undefined
}

export function listPlanningRemainingAnswerSourceAuthorityIssues({
  format,
  sourceResponse,
  answerSources,
  inferRemainingAnswers,
  explicitPlanningAnswerCount,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  answerSources?: GoalAnswerSourceInput[]
  inferRemainingAnswers: boolean
  explicitPlanningAnswerCount: number
}) {
  if (
    !inferRemainingAnswers ||
    explicitPlanningAnswerCount > 0 ||
    !formatWillUseAnswerSourceOnlyInterpretation(
      format,
      normalizeOptionalString(sourceResponse),
      answerSources,
    )
  ) {
    return [] as string[]
  }

  return listRemainingAnswerSourceSummaryAuthorityIssues(
    'Remaining planner answer source',
    answerSources ?? [],
  )
}

export function listDecisionTopicRemainingAnswerSourceAuthorityIssues({
  format,
  sourceResponse,
  answerSources,
  inferDecisionTopics,
  inferOpenDecisions,
  inferRemainingAnswers,
  explicitDecisionAnswerCount,
  explicitPlanningAnswerCount,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  answerSources?: GoalAnswerSourceInput[]
  inferDecisionTopics: boolean
  inferOpenDecisions: boolean
  inferRemainingAnswers: boolean
  explicitDecisionAnswerCount: number
  explicitPlanningAnswerCount?: number
}) {
  if (
    !inferDecisionTopics ||
    inferOpenDecisions ||
    explicitDecisionAnswerCount > 0 ||
    !formatWillUseAnswerSourceOnlyInterpretation(
      format,
      normalizeOptionalString(sourceResponse),
      answerSources,
    )
  ) {
    return [] as string[]
  }

  if (!inferRemainingAnswers) {
    return listRemainingAnswerSourceSummaryAuthorityIssues(
      'Remaining decision-topic answer source',
      answerSources ?? [],
    )
  }

  if ((explicitPlanningAnswerCount ?? 0) > 0) {
    return []
  }

  if (
    listMixedDecisionTopicAndRemainingAnswerIssues(
      format,
      answerSources,
      inferDecisionTopics,
      inferRemainingAnswers,
    ).length > 0
  ) {
    return []
  }

  const decisionEntries: GoalAnswerSourceInput[] = []
  const planningEntries: GoalAnswerSourceInput[] = []

  for (const answerSource of answerSources ?? []) {
    const route = resolveMixedRemainingAnswerSourceRoute(answerSource)
    if (route === 'decision') {
      decisionEntries.push(answerSource)
    } else if (route === 'planning') {
      planningEntries.push(answerSource)
    }
  }

  return [
    ...listRemainingAnswerSourceSummaryAuthorityIssues(
      'Remaining decision-topic answer source',
      decisionEntries,
    ),
    ...listRemainingAnswerSourceSummaryAuthorityIssues(
      'Remaining follow-through planner answer source',
      planningEntries,
    ),
  ]
}

function resolveRemainingDecisionAnswerSourceDescriptorKey(entry: GoalAnswerSourceInput) {
  const decisionKey = entry.decisionKey?.trim()
  if (decisionKey) {
    return `decisionKey:${decisionKey}`
  }

  const summaryKey = entry.summaryKey?.trim()
  if (summaryKey) {
    return `summaryKey:${summaryKey}`
  }

  const answerSourceKey = entry.answerSourceKey.trim()
  return `answerSourceKey:${answerSourceKey}`
}

function resolveRemainingPlanningAnswerSourceDescriptorKey(entry: GoalAnswerSourceInput) {
  const answerKey = entry.answerKey?.trim()
  if (answerKey) {
    return `answerKey:${answerKey}`
  }

  const summaryKey = entry.summaryKey?.trim()
  if (summaryKey) {
    return `summaryKey:${summaryKey}`
  }

  const answerSourceKey = entry.answerSourceKey.trim()
  return `answerSourceKey:${answerSourceKey}`
}

function listNonContiguousRemainingAnswerSourceRepeatIssues(
  label: string,
  entries: GoalAnswerSourceInput[],
  resolveDescriptorKey: (entry: GoalAnswerSourceInput) => string,
) {
  const issues: string[] = []
  const seenDescriptorKeys = new Set<string>()
  let currentDescriptorKey: string | undefined

  for (const entry of entries) {
    const descriptorKey = resolveDescriptorKey(entry)

    if (descriptorKey === currentDescriptorKey) {
      continue
    }

    if (seenDescriptorKeys.has(descriptorKey)) {
      const descriptorLabel = formatRemainingAnswerSourceDescriptorLabel(descriptorKey)
      issues.push(
        `Non-contiguous remaining answer sources repeated ${descriptorLabel} for ${label}.`,
      )
      continue
    }

    seenDescriptorKeys.add(descriptorKey)
    currentDescriptorKey = descriptorKey
  }

  return issues
}

function formatRemainingAnswerSourceDescriptorLabel(descriptorKey: string) {
  const separatorIndex = descriptorKey.indexOf(':')
  if (separatorIndex === -1) {
    return `"${descriptorKey}"`
  }

  const descriptorKind = descriptorKey.slice(0, separatorIndex)
  const descriptorValue = descriptorKey.slice(separatorIndex + 1)
  if (!descriptorKind || !descriptorValue) {
    return `"${descriptorKey}"`
  }

  return `${descriptorKind} "${descriptorValue}"`
}

export function normalizeRemainingAnswerSourceLabel(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
}

function mergeRemainingAnswerSourceMetadataValue(
  currentValue: string | undefined,
  nextValue: string | undefined,
  fieldLabel: string,
  label: string,
  areEqual: (left: string, right: string) => boolean = (left, right) => left === right,
) {
  const current = currentValue?.trim() || undefined
  const next = nextValue?.trim() || undefined
  if (!current) {
    return next
  }
  if (!next) {
    return current
  }
  if (!areEqual(current, next)) {
    throw new Error(`Conflicting ${fieldLabel} values in answerSources for ${label}.`)
  }
  return current
}

function validateMergedRemainingAnswerSourceEntries(
  entries: GoalAnswerSourceInput[],
  label: string,
) {
  const [firstEntry, ...restEntries] = entries
  if (!firstEntry) {
    return
  }

  let mergedEntry = {
    sourceGroupKey: firstEntry.sourceGroupKey?.trim() || undefined,
    route: firstEntry.route?.trim() || undefined,
    decisionKey: firstEntry.decisionKey?.trim() || undefined,
    answerKey: firstEntry.answerKey?.trim() || undefined,
    summaryKey: firstEntry.summaryKey?.trim() || undefined,
    summary: firstEntry.summary?.trim() || undefined,
    prompt: firstEntry.prompt?.trim() || undefined,
  }

  for (const entry of restEntries) {
    mergedEntry = {
      sourceGroupKey: mergeRemainingAnswerSourceMetadataValue(
        mergedEntry.sourceGroupKey,
        entry.sourceGroupKey,
        'sourceGroupKey',
        label,
      ),
      route: mergeRemainingAnswerSourceMetadataValue(
        mergedEntry.route,
        entry.route,
        'route',
        label,
      ),
      decisionKey: mergeRemainingAnswerSourceMetadataValue(
        mergedEntry.decisionKey,
        entry.decisionKey,
        'decisionKey',
        label,
      ),
      answerKey: mergeRemainingAnswerSourceMetadataValue(
        mergedEntry.answerKey,
        entry.answerKey,
        'answerKey',
        label,
      ),
      summaryKey: mergeRemainingAnswerSourceMetadataValue(
        mergedEntry.summaryKey,
        entry.summaryKey,
        'summaryKey',
        label,
      ),
      summary: mergeRemainingAnswerSourceMetadataValue(
        mergedEntry.summary,
        entry.summary,
        'summary',
        label,
        (left, right) =>
          normalizeRemainingAnswerSourceLabel(left) === normalizeRemainingAnswerSourceLabel(right),
      ),
      prompt: mergeRemainingAnswerSourceMetadataValue(
        mergedEntry.prompt,
        entry.prompt,
        'prompt',
        label,
      ),
    }
  }
}

function listRemainingAnswerSourceMergeConflictIssues(
  label: string,
  entries: GoalAnswerSourceInput[],
  groupKeyResolver: (entry: GoalAnswerSourceInput) => string,
) {
  const issues: string[] = []
  let currentGroupKey: string | undefined
  let currentGroupEntries: GoalAnswerSourceInput[] = []

  const flushCurrentGroup = () => {
    if (currentGroupEntries.length <= 1) {
      currentGroupEntries = []
      return
    }

    try {
      validateMergedRemainingAnswerSourceEntries(currentGroupEntries, label)
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error))
    }
    currentGroupEntries = []
  }

  for (const entry of entries) {
    const groupKey = groupKeyResolver(entry)
    if (groupKey !== currentGroupKey) {
      flushCurrentGroup()
      currentGroupKey = groupKey
    }
    currentGroupEntries.push(entry)
  }

  flushCurrentGroup()
  return issues
}

export function listPlanningRemainingAnswerSourceContiguityIssues({
  format,
  sourceResponse,
  answerSources,
  inferRemainingAnswers,
  explicitPlanningAnswerCount,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  answerSources?: GoalAnswerSourceInput[]
  inferRemainingAnswers: boolean
  explicitPlanningAnswerCount: number
}) {
  if (
    !inferRemainingAnswers ||
    explicitPlanningAnswerCount > 0 ||
    !formatWillUseAnswerSourceOnlyInterpretation(
      format,
      normalizeOptionalString(sourceResponse),
      answerSources,
    )
  ) {
    return [] as string[]
  }

  return listNonContiguousRemainingAnswerSourceRepeatIssues(
    'inferRemainingAnswers',
    answerSources ?? [],
    resolveRemainingPlanningAnswerSourceDescriptorKey,
  )
}

export function listPlanningRemainingAnswerSourceMergeConflictIssues({
  format,
  sourceResponse,
  answerSources,
  inferRemainingAnswers,
  explicitPlanningAnswerCount,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  answerSources?: GoalAnswerSourceInput[]
  inferRemainingAnswers: boolean
  explicitPlanningAnswerCount: number
}) {
  if (
    !inferRemainingAnswers ||
    explicitPlanningAnswerCount > 0 ||
    !formatWillUseAnswerSourceOnlyInterpretation(
      format,
      normalizeOptionalString(sourceResponse),
      answerSources,
    )
  ) {
    return [] as string[]
  }

  return listRemainingAnswerSourceMergeConflictIssues(
    'followThrough.inferRemainingAnswers',
    answerSources ?? [],
    resolveRemainingPlanningAnswerSourceDescriptorKey,
  )
}

export function listDecisionTopicRemainingAnswerSourceContiguityIssues({
  format,
  sourceResponse,
  answerSources,
  inferDecisionTopics,
  inferOpenDecisions,
  inferRemainingAnswers,
  explicitDecisionAnswerCount,
  explicitPlanningAnswerCount,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  answerSources?: GoalAnswerSourceInput[]
  inferDecisionTopics: boolean
  inferOpenDecisions: boolean
  inferRemainingAnswers: boolean
  explicitDecisionAnswerCount: number
  explicitPlanningAnswerCount?: number
}) {
  if (
    !inferDecisionTopics ||
    inferOpenDecisions ||
    explicitDecisionAnswerCount > 0 ||
    !formatWillUseAnswerSourceOnlyInterpretation(
      format,
      normalizeOptionalString(sourceResponse),
      answerSources,
    )
  ) {
    return [] as string[]
  }

  if (!inferRemainingAnswers) {
    return listNonContiguousRemainingAnswerSourceRepeatIssues(
      'inferDecisionTopics',
      answerSources ?? [],
      resolveRemainingDecisionAnswerSourceDescriptorKey,
    )
  }

  if ((explicitPlanningAnswerCount ?? 0) > 0) {
    return []
  }

  if (
    listMixedDecisionTopicAndRemainingAnswerIssues(
      format,
      answerSources,
      inferDecisionTopics,
      inferRemainingAnswers,
    ).length > 0
  ) {
    return []
  }

  const issues: string[] = []
  const seenDescriptorKeys = new Set<string>()
  let currentDescriptorKey: string | undefined
  let currentRoute: 'decision' | 'planning' | undefined

  for (const entry of answerSources ?? []) {
    const route = resolveMixedRemainingAnswerSourceRoute(entry)
    if (!route) {
      continue
    }

    const descriptorKey =
      route === 'decision'
        ? resolveRemainingDecisionAnswerSourceDescriptorKey(entry)
        : resolveRemainingPlanningAnswerSourceDescriptorKey(entry)

    if (descriptorKey === currentDescriptorKey && route === currentRoute) {
      continue
    }

    if (seenDescriptorKeys.has(descriptorKey)) {
      const descriptorLabel = formatRemainingAnswerSourceDescriptorLabel(descriptorKey)
      issues.push(
        `Non-contiguous remaining answer sources repeated ${descriptorLabel} for mixed remaining answer inference.`,
      )
      continue
    }

    seenDescriptorKeys.add(descriptorKey)
    currentDescriptorKey = descriptorKey
    currentRoute = route
  }

  return issues
}

export function listDecisionTopicRemainingAnswerSourceMergeConflictIssues({
  format,
  sourceResponse,
  answerSources,
  inferDecisionTopics,
  inferOpenDecisions,
  inferRemainingAnswers,
  explicitDecisionAnswerCount,
  explicitPlanningAnswerCount,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  answerSources?: GoalAnswerSourceInput[]
  inferDecisionTopics: boolean
  inferOpenDecisions: boolean
  inferRemainingAnswers: boolean
  explicitDecisionAnswerCount: number
  explicitPlanningAnswerCount?: number
}) {
  if (
    !inferDecisionTopics ||
    inferOpenDecisions ||
    explicitDecisionAnswerCount > 0 ||
    !formatWillUseAnswerSourceOnlyInterpretation(
      format,
      normalizeOptionalString(sourceResponse),
      answerSources,
    )
  ) {
    return [] as string[]
  }

  if (!inferRemainingAnswers) {
    return listRemainingAnswerSourceMergeConflictIssues(
      'inferDecisionTopics',
      answerSources ?? [],
      resolveRemainingDecisionAnswerSourceDescriptorKey,
    )
  }

  if ((explicitPlanningAnswerCount ?? 0) > 0) {
    return []
  }

  if (
    listMixedDecisionTopicAndRemainingAnswerIssues(
      format,
      answerSources,
      inferDecisionTopics,
      inferRemainingAnswers,
    ).length > 0
  ) {
    return []
  }

  return listRemainingAnswerSourceMergeConflictIssues(
    'inferDecisionTopics + followThrough.inferRemainingAnswers',
    answerSources ?? [],
    (entry) => {
      const route = resolveMixedRemainingAnswerSourceRoute(entry) ?? 'planning'
      const descriptorKey =
        route === 'decision'
          ? resolveRemainingDecisionAnswerSourceDescriptorKey(entry)
          : resolveRemainingPlanningAnswerSourceDescriptorKey(entry)
      return `${route}:${descriptorKey}`
    },
  )
}

export function humanizeRemainingAnswerSourceKey(value: string | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const humanized = trimmed.replace(/[_-]+/g, ' ')
  const stripped = humanized.replace(/\s+(?:answer|source)$/i, '').trim()
  if (!stripped || stripped === humanized.trim()) {
    return undefined
  }

  return stripped
}

export function humanizeRemainingDecisionDescriptorKey(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/[_-]+/g, ' ') : undefined
}

export function inferExactRemainingDecisionTopicSummary(entry: GoalAnswerSourceInput) {
  if (entry.summary?.trim()) {
    return entry.summary.trim()
  }

  const decisionKeySummary = humanizeRemainingDecisionDescriptorKey(entry.decisionKey)
  if (decisionKeySummary) {
    return decisionKeySummary
  }

  const summaryKeySummary = humanizeRemainingDecisionDescriptorKey(entry.summaryKey)
  if (summaryKeySummary) {
    return summaryKeySummary
  }

  return humanizeRemainingAnswerSourceKey(entry.answerSourceKey)
}

export function buildKnownDecisionSummaryCountMap(decisions: GoalDecision[]) {
  const counts = new Map<string, number>()

  for (const decision of decisions) {
    const candidateSummaries = [
      decision.summary,
      humanizeRemainingDecisionDescriptorKey(decision.summaryKey),
    ]
    const seenSummaries = new Set<string>()

    for (const candidateSummary of candidateSummaries) {
      const normalizedSummary = normalizeRemainingAnswerSourceLabel(candidateSummary ?? '')
      if (!normalizedSummary || seenSummaries.has(normalizedSummary)) {
        continue
      }

      seenSummaries.add(normalizedSummary)
      counts.set(normalizedSummary, (counts.get(normalizedSummary) ?? 0) + 1)
    }
  }

  return counts
}

export function buildKnownDecisionSummaryLookup(decisions: GoalDecision[]) {
  const summaries = new Set<string>()

  for (const decision of decisions) {
    const candidateSummaries = [
      decision.summary,
      humanizeRemainingDecisionDescriptorKey(decision.summaryKey),
    ]

    for (const candidateSummary of candidateSummaries) {
      const normalizedSummary = normalizeRemainingAnswerSourceLabel(candidateSummary ?? '')
      if (!normalizedSummary) {
        continue
      }
      summaries.add(normalizedSummary)
    }
  }

  return summaries
}

export function listDecisionTopicRemainingKnownDecisionAmbiguityIssues({
  format,
  sourceResponse,
  answerSources,
  decisions,
  inferDecisionTopics,
  inferOpenDecisions,
  inferRemainingAnswers,
  explicitDecisionAnswerCount,
  explicitPlanningAnswerCount,
}: {
  format: GoalSourceResponseFormat
  sourceResponse: string
  answerSources?: GoalAnswerSourceInput[]
  decisions: GoalDecision[]
  inferDecisionTopics: boolean
  inferOpenDecisions: boolean
  inferRemainingAnswers: boolean
  explicitDecisionAnswerCount: number
  explicitPlanningAnswerCount?: number
}) {
  if (
    !inferDecisionTopics ||
    inferOpenDecisions ||
    explicitDecisionAnswerCount > 0 ||
    !formatWillUseAnswerSourceOnlyInterpretation(
      format,
      normalizeOptionalString(sourceResponse),
      answerSources,
    )
  ) {
    return [] as string[]
  }

  if (
    inferRemainingAnswers &&
    ((explicitPlanningAnswerCount ?? 0) > 0 ||
      listMixedDecisionTopicAndRemainingAnswerIssues(
        format,
        answerSources,
        inferDecisionTopics,
        inferRemainingAnswers,
      ).length > 0)
  ) {
    return []
  }

  const candidateEntries = inferRemainingAnswers
    ? (answerSources ?? []).filter(
        (entry) => resolveMixedRemainingAnswerSourceRoute(entry) === 'decision',
      )
    : (answerSources ?? [])
  const knownDecisionKeys = new Set(
    decisions
      .map((decision) => decision.decisionKey.trim())
      .filter((decisionKey) => decisionKey.length > 0),
  )
  const summaryCounts = buildKnownDecisionSummaryCountMap(decisions)
  const issues: string[] = []
  const seenSummaries = new Set<string>()

  for (const entry of candidateEntries) {
    const decisionKey = entry.decisionKey?.trim()
    if (decisionKey && knownDecisionKeys.has(decisionKey)) {
      continue
    }

    const inferredSummary = inferExactRemainingDecisionTopicSummary(entry)
    if (!inferredSummary) {
      continue
    }

    const normalizedSummary = normalizeRemainingAnswerSourceLabel(inferredSummary)
    if (!normalizedSummary || seenSummaries.has(normalizedSummary)) {
      continue
    }

    if ((summaryCounts.get(normalizedSummary) ?? 0) > 1) {
      issues.push(
        `Multiple existing decisions match inferred answerSource summary "${inferredSummary}".`,
      )
      seenSummaries.add(normalizedSummary)
    }
  }

  return issues
}
