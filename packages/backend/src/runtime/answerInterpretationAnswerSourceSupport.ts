import { AnswerInterpretationError } from './answerInterpretationErrors'
import {
  buildAnswerSourceResponseCandidates,
  dedupeNonEmptyStrings,
  normalizeSourceResponseLabel,
} from './answerInterpretationStrings'

export interface ResolvedAnswerSourceEntry {
  key: string
  sourceKeys: string[]
  sourceGroupKey?: string
  answer: string
  route?: RemainingAnswerSourceRoute
  decisionKey?: string
  answerKey?: string
  summaryKey?: string
  summary?: string
  prompt?: string
  matchHints?: string[]
  candidates: string[]
}

export interface RemainingAnswerSourceGroupDescriptor {
  key: string
  label: string
}

export interface GroupedAnswerSourceEntry {
  indexes: number[]
  entry: ResolvedAnswerSourceEntry
}

export type RemainingAnswerSourceRoute = 'decision' | 'planning'

export interface RoutedGroupedAnswerSourceEntry extends GroupedAnswerSourceEntry {
  route: RemainingAnswerSourceRoute
}

export interface PendingAnswerSourceConsumerDescriptor {
  family: RemainingAnswerSourceRoute
  keys: string[]
}

type InterpretableAnswerSourceMetadataInput = {
  answerSourceKey: string
  sourceGroupKey?: string
  route?: RemainingAnswerSourceRoute
  decisionKey?: string
  answerKey?: string
  summaryKey?: string
  summary?: string
  prompt?: string
  matchHints?: string[]
}

export type InterpretableAnswerSourceInput =
  | (InterpretableAnswerSourceMetadataInput & {
      answer: string
    })
  | (InterpretableAnswerSourceMetadataInput & {
      sourceExcerpt: string
      sourceOccurrence?: number
    })

export interface ResolvedAnswerSources {
  byKey: Map<string, string>
  byGroupKey: Map<string, string>
  entries: ResolvedAnswerSourceEntry[]
}

export function resolveSourceExcerpt(
  sourceExcerpt: string | undefined,
  sourceOccurrence: number | undefined,
  sourceResponse: string | undefined,
  label: string,
) {
  const excerpt = sourceExcerpt?.trim()
  const occurrence = normalizeSourceExcerptOccurrence(sourceOccurrence, label, Boolean(excerpt))
  if (!excerpt) {
    return undefined
  }

  const shared = sourceResponse?.trim()
  if (!shared) {
    throw new AnswerInterpretationError(`sourceExcerpt for ${label} requires sourceResponse.`)
  }
  const occurrences = listSourceExcerptOccurrences(shared, excerpt)
  if (occurrences.length === 0) {
    throw new AnswerInterpretationError(
      `sourceExcerpt for ${label} was not found in sourceResponse.`,
    )
  }
  if (occurrence === undefined) {
    if (occurrences.length > 1) {
      throw new AnswerInterpretationError(
        `sourceExcerpt for ${label} matched ${occurrences.length} occurrences in sourceResponse. Provide sourceOccurrence to disambiguate.`,
      )
    }
    return excerpt
  }
  if (occurrence > occurrences.length) {
    throw new AnswerInterpretationError(
      `sourceExcerpt for ${label} requested sourceOccurrence ${occurrence} but only ${occurrences.length} occurrences were found in sourceResponse.`,
    )
  }
  return excerpt
}

function normalizeSourceExcerptOccurrence(
  sourceOccurrence: number | undefined,
  label: string,
  hasSourceExcerpt: boolean,
) {
  if (sourceOccurrence === undefined) {
    return undefined
  }
  if (!hasSourceExcerpt) {
    throw new AnswerInterpretationError(`sourceOccurrence for ${label} requires sourceExcerpt.`)
  }
  if (!Number.isInteger(sourceOccurrence) || sourceOccurrence < 1) {
    throw new AnswerInterpretationError(`sourceOccurrence for ${label} must be a positive integer.`)
  }
  return sourceOccurrence
}

function listSourceExcerptOccurrences(sourceResponse: string, sourceExcerpt: string) {
  const occurrences: number[] = []
  let nextIndex = 0
  while (nextIndex <= sourceResponse.length - sourceExcerpt.length) {
    const matchIndex = sourceResponse.indexOf(sourceExcerpt, nextIndex)
    if (matchIndex === -1) {
      break
    }
    occurrences.push(matchIndex)
    nextIndex = matchIndex + sourceExcerpt.length
  }
  return occurrences
}

export function buildDecisionPendingAnswerSourceConsumerDescriptor(input: {
  decisionKey?: string
  summaryKey?: string
}): PendingAnswerSourceConsumerDescriptor {
  const keys = [
    input.decisionKey?.trim() ? `decisionKey:${input.decisionKey.trim()}` : undefined,
    input.summaryKey?.trim() ? `summaryKey:${input.summaryKey.trim()}` : undefined,
  ].filter((key): key is string => Boolean(key))

  return { family: 'decision', keys }
}

export function buildPlanningPendingAnswerSourceConsumerDescriptor(input: {
  answerKey?: string
  summaryKey?: string
}): PendingAnswerSourceConsumerDescriptor {
  const keys = [
    input.answerKey?.trim() ? `answerKey:${input.answerKey.trim()}` : undefined,
    input.summaryKey?.trim() ? `summaryKey:${input.summaryKey.trim()}` : undefined,
  ].filter((key): key is string => Boolean(key))

  return { family: 'planning', keys }
}

function formatAnswerSourceRouteLabel(route: RemainingAnswerSourceRoute | undefined) {
  return route ? `route "${route}"` : undefined
}

export function listPendingAnswerSourceEntryAuthorities(entry: ResolvedAnswerSourceEntry) {
  return [
    formatAnswerSourceRouteLabel(entry.route),
    entry.decisionKey?.trim() ? `decisionKey "${entry.decisionKey.trim()}"` : undefined,
    entry.answerKey?.trim() ? `answerKey "${entry.answerKey.trim()}"` : undefined,
    entry.summaryKey?.trim() ? `summaryKey "${entry.summaryKey.trim()}"` : undefined,
  ].filter((authority): authority is string => Boolean(authority))
}

function listPendingAnswerSourceEntryGroupingAuthorityKeys(entry: ResolvedAnswerSourceEntry) {
  return [
    entry.decisionKey?.trim() ? `decisionKey:${entry.decisionKey.trim()}` : undefined,
    entry.answerKey?.trim() ? `answerKey:${entry.answerKey.trim()}` : undefined,
    entry.summaryKey?.trim() ? `summaryKey:${entry.summaryKey.trim()}` : undefined,
  ].filter((authority): authority is string => Boolean(authority))
}

export function formatPendingAnswerSourceAuthorityLabels(authorities: string[]) {
  if (authorities.length <= 1) {
    return authorities[0] ?? 'authority'
  }
  if (authorities.length === 2) {
    return `${authorities[0]} and ${authorities[1]}`
  }
  return `${authorities.slice(0, -1).join(', ')}, and ${authorities.at(-1)}`
}

export function entryMatchesPendingAnswerSourceConsumer(
  entry: ResolvedAnswerSourceEntry,
  consumerDescriptor: PendingAnswerSourceConsumerDescriptor,
) {
  if (entry.route && entry.route !== consumerDescriptor.family) {
    return false
  }

  const authorityKeys = listPendingAnswerSourceEntryGroupingAuthorityKeys(entry)
  if (authorityKeys.length === 0) {
    return true
  }

  return (
    consumerDescriptor.keys.length > 0 &&
    authorityKeys.every((key) => consumerDescriptor.keys.includes(key))
  )
}

export function entryHasPendingAnswerSourceGroupingAuthority(entry: ResolvedAnswerSourceEntry) {
  return listPendingAnswerSourceEntryGroupingAuthorityKeys(entry).length > 0
}

export function findNonContiguousPendingAnswerSourceAuthority(
  entries: ResolvedAnswerSourceEntry[],
  startIndex: number,
  consumerDescriptor: PendingAnswerSourceConsumerDescriptor,
) {
  for (let index = startIndex; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) {
      continue
    }
    if (
      entryHasPendingAnswerSourceGroupingAuthority(entry) &&
      entryMatchesPendingAnswerSourceConsumer(entry, consumerDescriptor)
    ) {
      return formatPendingAnswerSourceAuthorityLabels(
        listPendingAnswerSourceEntryAuthorities(entry),
      )
    }
  }
  return undefined
}

function mergeAnswerSourceMetadataValue(
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
    throw new AnswerInterpretationError(
      `Conflicting ${fieldLabel} values in answerSources for ${label}.`,
    )
  }
  return current
}

export function mergeAnswerSourceEntries(
  entries: ResolvedAnswerSourceEntry[],
  label: string,
): ResolvedAnswerSourceEntry {
  const [firstEntry, ...restEntries] = entries
  if (!firstEntry) {
    throw new AnswerInterpretationError(`No answerSources remained for ${label}.`)
  }

  let mergedEntry: ResolvedAnswerSourceEntry = {
    ...firstEntry,
    sourceKeys: [...firstEntry.sourceKeys],
    ...(firstEntry.matchHints?.length
      ? { matchHints: [...firstEntry.matchHints] }
      : { matchHints: undefined }),
    candidates: [...firstEntry.candidates],
  }
  const answers = [firstEntry.answer]

  for (const entry of restEntries) {
    answers.push(entry.answer)
    mergedEntry = {
      ...mergedEntry,
      sourceGroupKey: mergeAnswerSourceMetadataValue(
        mergedEntry.sourceGroupKey,
        entry.sourceGroupKey,
        'sourceGroupKey',
        label,
      ),
      route: mergeAnswerSourceMetadataValue(mergedEntry.route, entry.route, 'route', label) as
        | RemainingAnswerSourceRoute
        | undefined,
      decisionKey: mergeAnswerSourceMetadataValue(
        mergedEntry.decisionKey,
        entry.decisionKey,
        'decisionKey',
        label,
      ),
      answerKey: mergeAnswerSourceMetadataValue(
        mergedEntry.answerKey,
        entry.answerKey,
        'answerKey',
        label,
      ),
      summaryKey: mergeAnswerSourceMetadataValue(
        mergedEntry.summaryKey,
        entry.summaryKey,
        'summaryKey',
        label,
      ),
      summary: mergeAnswerSourceMetadataValue(
        mergedEntry.summary,
        entry.summary,
        'summary',
        label,
        (left, right) => normalizeSourceResponseLabel(left) === normalizeSourceResponseLabel(right),
      ),
      prompt: mergeAnswerSourceMetadataValue(mergedEntry.prompt, entry.prompt, 'prompt', label),
      matchHints: dedupeNonEmptyStrings([
        ...(mergedEntry.matchHints ?? []),
        ...(entry.matchHints ?? []),
      ]),
      sourceKeys: dedupeNonEmptyStrings([...mergedEntry.sourceKeys, ...entry.sourceKeys]),
      candidates: dedupeNonEmptyStrings([...mergedEntry.candidates, ...entry.candidates]),
    }
  }

  return {
    ...mergedEntry,
    key: mergedEntry.sourceGroupKey ?? mergedEntry.key,
    answer: answers.join('\n\n'),
  }
}

function createFallbackAnswerSourceGroupDescriptor(
  entry: ResolvedAnswerSourceEntry,
): RemainingAnswerSourceGroupDescriptor {
  return {
    key: `answerSourceKey:${entry.key}`,
    label: `answerSourceKey "${entry.key}"`,
  }
}

export function resolveRemainingMatchingDecisionAnswerSourceGroupDescriptor(
  entry: ResolvedAnswerSourceEntry,
): RemainingAnswerSourceGroupDescriptor | undefined {
  const decisionKey = entry.decisionKey?.trim()
  if (decisionKey) {
    return {
      key: `decisionKey:${decisionKey}`,
      label: `decisionKey "${decisionKey}"`,
    }
  }

  const summaryKey = entry.summaryKey?.trim()
  if (summaryKey) {
    return {
      key: `summaryKey:${summaryKey}`,
      label: `summaryKey "${summaryKey}"`,
    }
  }

  return undefined
}

export function resolveRemainingMatchingPlanningAnswerSourceGroupDescriptor(
  entry: ResolvedAnswerSourceEntry,
): RemainingAnswerSourceGroupDescriptor | undefined {
  const answerKey = entry.answerKey?.trim()
  if (answerKey) {
    return {
      key: `answerKey:${answerKey}`,
      label: `answerKey "${answerKey}"`,
    }
  }

  const summaryKey = entry.summaryKey?.trim()
  if (summaryKey) {
    return {
      key: `summaryKey:${summaryKey}`,
      label: `summaryKey "${summaryKey}"`,
    }
  }

  return undefined
}

export function groupRemainingAnswerSourceEntries(
  entries: ResolvedAnswerSourceEntry[],
  consumedIndexes: Set<number>,
  label: string,
  sourceFamilyLabel: 'matching' | 'pending',
  resolveGroupDescriptor: (
    entry: ResolvedAnswerSourceEntry,
  ) => RemainingAnswerSourceGroupDescriptor | undefined,
): GroupedAnswerSourceEntry[] {
  const groups: Array<{
    descriptor?: RemainingAnswerSourceGroupDescriptor
    indexes: number[]
    entries: ResolvedAnswerSourceEntry[]
  }> = []
  const seenDescriptorKeys = new Set<string>()

  for (const [index, entry] of entries.entries()) {
    if (consumedIndexes.has(index)) {
      continue
    }

    const descriptor = resolveGroupDescriptor(entry)
    const currentGroup = groups.at(-1)
    if (descriptor && currentGroup?.descriptor?.key === descriptor.key) {
      currentGroup.indexes.push(index)
      currentGroup.entries.push(entry)
      continue
    }

    if (descriptor && seenDescriptorKeys.has(descriptor.key)) {
      throw new AnswerInterpretationError(
        `Non-contiguous ${sourceFamilyLabel} answerSources repeated ${descriptor.label} for ${label}.`,
      )
    }

    if (descriptor) {
      seenDescriptorKeys.add(descriptor.key)
    }
    groups.push({
      descriptor,
      indexes: [index],
      entries: [entry],
    })
  }

  return groups.map((group) => ({
    indexes: group.indexes,
    entry:
      group.entries.length === 1 && group.entries[0]
        ? group.entries[0]
        : mergeAnswerSourceEntries(group.entries, label),
  }))
}

function resolveRemainingMixedAnswerSourceRoute(entry: ResolvedAnswerSourceEntry): {
  route: RemainingAnswerSourceRoute
  descriptor: RemainingAnswerSourceGroupDescriptor
} {
  const route = entry.route
  const decisionKey = entry.decisionKey?.trim()
  const answerKey = entry.answerKey?.trim()

  if (decisionKey && answerKey) {
    throw new AnswerInterpretationError(
      `Remaining answerSource "${entry.key}" cannot target both decisionKey "${decisionKey}" and answerKey "${answerKey}" when inferDecisionTopics is combined with followThrough.inferRemainingAnswers.`,
    )
  }

  if (route === 'decision' && answerKey) {
    throw new AnswerInterpretationError(
      `Remaining answerSource "${entry.key}" cannot combine route "decision" with answerKey "${answerKey}" when inferDecisionTopics is combined with followThrough.inferRemainingAnswers.`,
    )
  }

  if (route === 'planning' && decisionKey) {
    throw new AnswerInterpretationError(
      `Remaining answerSource "${entry.key}" cannot combine route "planning" with decisionKey "${decisionKey}" when inferDecisionTopics is combined with followThrough.inferRemainingAnswers.`,
    )
  }

  if (route === 'decision') {
    return {
      route,
      descriptor:
        resolveRemainingMatchingDecisionAnswerSourceGroupDescriptor(entry) ??
        createFallbackAnswerSourceGroupDescriptor(entry),
    }
  }

  if (route === 'planning') {
    return {
      route,
      descriptor:
        resolveRemainingMatchingPlanningAnswerSourceGroupDescriptor(entry) ??
        createFallbackAnswerSourceGroupDescriptor(entry),
    }
  }

  if (decisionKey) {
    return {
      route: 'decision',
      descriptor: {
        key: `decisionKey:${decisionKey}`,
        label: `decisionKey "${decisionKey}"`,
      },
    }
  }

  if (answerKey) {
    return {
      route: 'planning',
      descriptor: {
        key: `answerKey:${answerKey}`,
        label: `answerKey "${answerKey}"`,
      },
    }
  }

  throw new AnswerInterpretationError(
    `Remaining answerSource "${entry.key}" requires explicit route, decisionKey, or answerKey when inferDecisionTopics is combined with followThrough.inferRemainingAnswers.`,
  )
}

export function groupMixedRemainingAnswerSourceEntries(
  entries: ResolvedAnswerSourceEntry[],
  consumedIndexes: Set<number>,
  sourceFamilyLabel: 'matching' | 'pending',
): RoutedGroupedAnswerSourceEntry[] {
  const groups: Array<{
    route: RemainingAnswerSourceRoute
    descriptor: RemainingAnswerSourceGroupDescriptor
    indexes: number[]
    entries: ResolvedAnswerSourceEntry[]
  }> = []
  const seenDescriptorKeys = new Set<string>()

  for (const [index, entry] of entries.entries()) {
    if (consumedIndexes.has(index)) {
      continue
    }

    const { route, descriptor } = resolveRemainingMixedAnswerSourceRoute(entry)
    const currentGroup = groups.at(-1)
    if (
      currentGroup &&
      currentGroup.route === route &&
      currentGroup.descriptor.key === descriptor.key
    ) {
      currentGroup.indexes.push(index)
      currentGroup.entries.push(entry)
      continue
    }

    if (seenDescriptorKeys.has(descriptor.key)) {
      throw new AnswerInterpretationError(
        `Non-contiguous ${sourceFamilyLabel} answerSources repeated ${descriptor.label} for mixed remaining answer inference.`,
      )
    }

    seenDescriptorKeys.add(descriptor.key)
    groups.push({
      route,
      descriptor,
      indexes: [index],
      entries: [entry],
    })
  }

  return groups.map((group) => ({
    route: group.route,
    indexes: group.indexes,
    entry:
      group.entries.length === 1 && group.entries[0]
        ? group.entries[0]
        : mergeAnswerSourceEntries(
            group.entries,
            'inferDecisionTopics + followThrough.inferRemainingAnswers',
          ),
  }))
}

export function findMatchingAnswerSourceEntryIndexes(
  entries: ResolvedAnswerSourceEntry[],
  candidates: string[],
  consumedIndexes: Set<number>,
  consumerFamily?: RemainingAnswerSourceRoute,
) {
  const normalizedCandidates = new Set(
    candidates.map((candidate) => normalizeSourceResponseLabel(candidate)).filter(Boolean),
  )
  return entries.flatMap((entry, index) => {
    if (consumedIndexes.has(index)) {
      return []
    }
    if (consumerFamily && entry.route && entry.route !== consumerFamily) {
      return []
    }
    const hasMatch = entry.candidates.some((candidate) =>
      normalizedCandidates.has(normalizeSourceResponseLabel(candidate)),
    )
    return hasMatch ? [index] : []
  })
}

export function createResolvedAnswerSources(
  answerSources: InterpretableAnswerSourceInput[] | undefined,
  sourceResponse: string | undefined,
) {
  if (!answerSources || answerSources.length === 0) {
    return undefined
  }

  const answerSourcesByKey = new Map<string, string>()
  const answerSourceGroupsByKey = new Map<string, string>()
  const entries: ResolvedAnswerSourceEntry[] = []
  const groupedEntryIndexBySourceGroupKey = new Map<string, number>()
  for (const source of answerSources) {
    const key = source.answerSourceKey.trim()
    if (answerSourcesByKey.has(key)) {
      throw new AnswerInterpretationError(`Duplicate answerSourceKey: ${key}`)
    }
    let resolved: string
    if ('answer' in source) {
      resolved = source.answer.trim()
    } else {
      resolved = resolveSourceExcerpt(
        source.sourceExcerpt,
        source.sourceOccurrence,
        sourceResponse,
        `answerSourceKey "${key}"`,
      ) as string
    }
    const decisionKey = source.decisionKey?.trim() || undefined
    const summaryKey = source.summaryKey?.trim() || undefined
    const answerKey = source.answerKey?.trim() || undefined
    const sourceGroupKey = source.sourceGroupKey?.trim() || undefined
    const route = source.route
    const summary = source.summary?.trim() || undefined
    const prompt = source.prompt?.trim() || undefined
    const matchHints = dedupeNonEmptyStrings(source.matchHints ?? [])
    answerSourcesByKey.set(key, resolved)
    const entry: ResolvedAnswerSourceEntry = {
      key: sourceGroupKey ?? key,
      sourceKeys: [key],
      sourceGroupKey,
      answer: resolved,
      route,
      decisionKey,
      answerKey,
      summaryKey,
      summary,
      prompt,
      ...(matchHints.length ? { matchHints } : {}),
      candidates: buildAnswerSourceResponseCandidates(source),
    }
    if (!sourceGroupKey) {
      entries.push(entry)
      continue
    }
    const existingIndex = groupedEntryIndexBySourceGroupKey.get(sourceGroupKey)
    if (existingIndex === undefined) {
      groupedEntryIndexBySourceGroupKey.set(sourceGroupKey, entries.length)
      entries.push(entry)
      answerSourceGroupsByKey.set(sourceGroupKey, resolved)
      continue
    }
    const existingEntry = entries[existingIndex]
    if (!existingEntry) {
      throw new AnswerInterpretationError(
        `Missing grouped answerSource entry for sourceGroupKey "${sourceGroupKey}".`,
      )
    }
    const mergedEntry = mergeAnswerSourceEntries(
      [existingEntry, entry],
      `sourceGroupKey "${sourceGroupKey}"`,
    )
    entries[existingIndex] = mergedEntry
    answerSourceGroupsByKey.set(sourceGroupKey, mergedEntry.answer)
  }
  return {
    byKey: answerSourcesByKey,
    byGroupKey: answerSourceGroupsByKey,
    entries,
  } satisfies ResolvedAnswerSources
}
