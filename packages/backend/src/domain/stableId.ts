import { z } from 'zod'

export const STABLE_ID_SOURCE = String.raw`[\p{L}\p{N}][\p{L}\p{N}\p{M}._-]*`
export const STABLE_ID_PATTERN = new RegExp(`^${STABLE_ID_SOURCE}$`, 'u')
export const stableIdSchema = z.string().regex(STABLE_ID_PATTERN)

const MAX_READABLE_STEM_LENGTH = 48

export function assertStableId(value: string, label: string) {
  if (!STABLE_ID_PATTERN.test(value)) throw new Error(`Invalid ${label}: ${value}`)
}

export function deriveReadableId(prefix: 'P' | 'G', source: string, usedIds: Iterable<string>) {
  const prefixMarker = `${prefix}-`
  const sourceWithoutPrefix = source
    .trim()
    .toLocaleLowerCase('en-US')
    .startsWith(prefixMarker.toLocaleLowerCase('en-US'))
    ? source.trim().slice(prefixMarker.length)
    : source
  const fallback = prefix === 'P' ? 'project' : 'goal'
  const stem = readableStem(sourceWithoutPrefix, fallback)
  const base = `${prefix}-${stem}`
  const used = new Set([...usedIds].map(comparisonKey))
  if (!used.has(comparisonKey(base))) return base

  let suffix = 2
  while (used.has(comparisonKey(`${base}-${suffix}`))) suffix += 1
  return `${base}-${suffix}`
}

function readableStem(source: string, fallback: string) {
  const normalized = source
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}\p{M}._-]+/gu, '-')
    .replace(/[._-]{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
  const limited = [...normalized]
    .slice(0, MAX_READABLE_STEM_LENGTH)
    .join('')
    .replace(/[._-]+$/g, '')
  return limited || fallback
}

function comparisonKey(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('en-US')
}
