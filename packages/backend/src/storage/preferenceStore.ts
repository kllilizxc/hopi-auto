import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import { createProjectPaths } from './paths'

export const PREFERENCE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export type PreferenceStatus = 'active' | 'retired'

export interface PreferenceEntry {
  preferenceKey: string
  status: PreferenceStatus
  summary: string
  rationale?: string
  retiredReason?: string
  supersededBy?: string
}

export interface PreferenceDocument {
  path: string
  content: string
  entries: PreferenceEntry[]
}

export interface RecordPreferenceInput {
  preferenceKey?: string
  summary: string
  rationale?: string
  supersedes?: string[]
}

export interface RetirePreferenceInput {
  preferenceKey: string
  reason: string
  supersededBy?: string
}

export interface PreferenceStore {
  readPreferences(): Promise<PreferenceDocument>
  writePreferences(content: string): Promise<PreferenceDocument>
  recordPreference(input: RecordPreferenceInput): Promise<PreferenceDocument>
  retirePreference(input: RetirePreferenceInput): Promise<PreferenceDocument>
}

export class PreferenceStoreError extends Error {}

const preferenceEntrySchema = z.object({
  preferenceKey: z.string().regex(PREFERENCE_KEY_PATTERN),
  status: z.enum(['active', 'retired']),
  summary: z.string().min(1),
  rationale: z.string().min(1).optional(),
  retiredReason: z.string().min(1).optional(),
  supersededBy: z.string().regex(PREFERENCE_KEY_PATTERN).optional(),
})

const preferenceFileSchema = z.object({
  version: z.literal(1).default(1),
  preferences: z.array(preferenceEntrySchema).default([]),
})

const LEGACY_EMPTY_MARKER = 'Durable project preferences have not been recorded yet.'

const DEFAULT_PREFERENCES = renderPreferenceDocument([])

export function createPreferenceStore(rootDir = process.cwd()): PreferenceStore {
  const paths = createProjectPaths(rootDir)

  return {
    async readPreferences() {
      return readOrBootstrapPreferences(paths.preferencePath())
    },
    async writePreferences(content) {
      const path = paths.preferencePath()
      const entries = parsePreferenceContent(content)
      return writePreferenceEntries(path, entries)
    },
    async recordPreference(input) {
      const path = paths.preferencePath()
      const current = await readOrBootstrapPreferences(path)
      const summary = input.summary.trim()
      if (!summary) {
        return current
      }

      const preferenceKey = normalizePreferenceKey(input.preferenceKey ?? slugify(summary))
      const nextEntries = current.entries.map((entry) => ({ ...entry }))
      const currentIndex = nextEntries.findIndex((entry) => entry.preferenceKey === preferenceKey)
      const currentEntry = currentIndex >= 0 ? nextEntries[currentIndex] : undefined
      const rationale = normalizeOptionalText(input.rationale) ?? currentEntry?.rationale
      const nextEntry: PreferenceEntry = {
        preferenceKey,
        status: 'active',
        summary,
        ...(rationale ? { rationale } : {}),
      }

      if (currentIndex >= 0) {
        nextEntries[currentIndex] = nextEntry
      } else {
        nextEntries.push(nextEntry)
      }

      const supersedes = Array.from(
        new Set(
          (input.supersedes ?? [])
            .map(normalizePreferenceKey)
            .filter((key) => key !== preferenceKey),
        ),
      )
      for (const supersededKey of supersedes) {
        const supersededEntry = nextEntries.find((entry) => entry.preferenceKey === supersededKey)
        if (!supersededEntry) {
          throw new PreferenceStoreError(`Unknown preference key to supersede: ${supersededKey}`)
        }
        supersededEntry.status = 'retired'
        supersededEntry.supersededBy = preferenceKey
        supersededEntry.retiredReason = `Superseded by ${preferenceKey}.`
      }

      return writePreferenceEntries(path, nextEntries)
    },
    async retirePreference(input) {
      const path = paths.preferencePath()
      const current = await readOrBootstrapPreferences(path)
      const preferenceKey = normalizePreferenceKey(input.preferenceKey)
      const reason = input.reason.trim()
      if (!reason) {
        return current
      }

      const nextEntries = current.entries.map((entry) => ({ ...entry }))
      const target = nextEntries.find((entry) => entry.preferenceKey === preferenceKey)
      if (!target) {
        throw new PreferenceStoreError(`Unknown preference key to retire: ${preferenceKey}`)
      }

      const supersededBy = normalizeOptionalText(input.supersededBy)
      if (supersededBy) {
        const normalizedSupersededBy = normalizePreferenceKey(supersededBy)
        if (!nextEntries.some((entry) => entry.preferenceKey === normalizedSupersededBy)) {
          throw new PreferenceStoreError(
            `Unknown superseding preference key: ${normalizedSupersededBy}`,
          )
        }
        target.supersededBy = normalizedSupersededBy
      } else {
        target.supersededBy = undefined
      }

      target.status = 'retired'
      target.retiredReason = reason
      return writePreferenceEntries(path, nextEntries)
    },
  }
}

async function readOrBootstrapPreferences(path: string): Promise<PreferenceDocument> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    return writePreferenceEntries(path, [])
  }

  const content = await Bun.file(path).text()
  const entries = parsePreferenceContent(content)
  const canonicalContent = renderPreferenceDocument(entries)
  if (content !== canonicalContent) {
    return writePreferenceEntries(path, entries)
  }

  return {
    path,
    content,
    entries,
  }
}

function parsePreferenceContent(content: string) {
  const yamlBlock = extractYamlBlock(content)
  if (yamlBlock) {
    return parseStructuredPreferenceContent(yamlBlock)
  }

  if (isLegacyPreferenceDocument(content)) {
    return parseLegacyPreferenceEntries(content)
  }

  throw new PreferenceStoreError(
    'Invalid preference.md format: expected a fenced yaml preference document.',
  )
}

function parseStructuredPreferenceContent(source: string) {
  const parsed = preferenceFileSchema.safeParse(parse(source))
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join(', ')
    throw new PreferenceStoreError(`Invalid preference.md format: ${issues}`)
  }

  const entries = parsed.data.preferences.map((entry) => normalizePreferenceEntry(entry))
  assertValidPreferenceEntries(entries)
  return entries
}

function parseLegacyPreferenceEntries(content: string) {
  const trimmed = content.trim()
  if (
    trimmed === '' ||
    trimmed === LEGACY_EMPTY_MARKER ||
    trimmed === `# Preferences\n\n${LEGACY_EMPTY_MARKER}`
  ) {
    return []
  }

  const summaries = Array.from(
    new Set(
      content
        .split('\n')
        .map((line) => /^-\s+(.+)$/.exec(line.trim())?.[1]?.trim())
        .filter((line): line is string => Boolean(line)),
    ),
  )

  const usedKeys = new Set<string>()
  return summaries.map((summary) => {
    const baseKey = slugify(summary)
    const preferenceKey = ensureUniquePreferenceKey(baseKey, usedKeys)
    return {
      preferenceKey,
      status: 'active' as const,
      summary,
    }
  })
}

function extractYamlBlock(content: string) {
  const match = /```yaml\s*([\s\S]*?)```/m.exec(content)
  return match?.[1]?.trim()
}

function isLegacyPreferenceDocument(content: string) {
  const trimmed = content.trim()
  if (
    trimmed === '' ||
    trimmed === LEGACY_EMPTY_MARKER ||
    trimmed === `# Preferences\n\n${LEGACY_EMPTY_MARKER}`
  ) {
    return true
  }

  const nonEmptyLines = trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return nonEmptyLines.every(
    (line, index) => (index === 0 && line === '# Preferences') || line.startsWith('- '),
  )
}

function normalizePreferenceEntry(entry: z.infer<typeof preferenceEntrySchema>): PreferenceEntry {
  const normalized: PreferenceEntry = {
    preferenceKey: normalizePreferenceKey(entry.preferenceKey),
    status: entry.status,
    summary: entry.summary.trim(),
  }

  const rationale = normalizeOptionalText(entry.rationale)
  if (rationale) {
    normalized.rationale = rationale
  }

  const retiredReason = normalizeOptionalText(entry.retiredReason)
  if (retiredReason) {
    normalized.retiredReason = retiredReason
  }

  const supersededBy = normalizeOptionalText(entry.supersededBy)
  if (supersededBy) {
    normalized.supersededBy = normalizePreferenceKey(supersededBy)
  }

  return normalized
}

function assertValidPreferenceEntries(entries: PreferenceEntry[]) {
  const keys = new Set<string>()
  for (const entry of entries) {
    if (keys.has(entry.preferenceKey)) {
      throw new PreferenceStoreError(
        `Invalid preference.md format: duplicate preference key '${entry.preferenceKey}'`,
      )
    }
    keys.add(entry.preferenceKey)

    if (entry.status === 'active') {
      if (entry.retiredReason) {
        throw new PreferenceStoreError(
          `Invalid preference.md format: active preference '${entry.preferenceKey}' may not have retiredReason`,
        )
      }
      if (entry.supersededBy) {
        throw new PreferenceStoreError(
          `Invalid preference.md format: active preference '${entry.preferenceKey}' may not have supersededBy`,
        )
      }
    }
  }

  for (const entry of entries) {
    if (!entry.supersededBy) {
      continue
    }
    if (entry.supersededBy === entry.preferenceKey) {
      throw new PreferenceStoreError(
        `Invalid preference.md format: preference '${entry.preferenceKey}' may not supersede itself`,
      )
    }
    if (!keys.has(entry.supersededBy)) {
      throw new PreferenceStoreError(
        `Invalid preference.md format: preference '${entry.preferenceKey}' references unknown supersededBy '${entry.supersededBy}'`,
      )
    }
  }
}

async function writePreferenceEntries(
  path: string,
  entries: PreferenceEntry[],
): Promise<PreferenceDocument> {
  assertValidPreferenceEntries(entries)
  const content = renderPreferenceDocument(entries)
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, content)
  return {
    path,
    content,
    entries,
  }
}

function renderPreferenceDocument(entries: PreferenceEntry[]) {
  const content = stringify(
    {
      version: 1,
      preferences: entries.map((entry) => ({
        preferenceKey: entry.preferenceKey,
        status: entry.status,
        summary: entry.summary,
        ...(entry.rationale ? { rationale: entry.rationale } : {}),
        ...(entry.retiredReason ? { retiredReason: entry.retiredReason } : {}),
        ...(entry.supersededBy ? { supersededBy: entry.supersededBy } : {}),
      })),
    },
    { indent: 2 },
  ).trimEnd()

  return `# Preferences

\`\`\`yaml
${content}
\`\`\`
`
}

function normalizePreferenceKey(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!PREFERENCE_KEY_PATTERN.test(normalized)) {
    throw new PreferenceStoreError(
      `Invalid preference key '${value}'. Preference keys must match ${PREFERENCE_KEY_PATTERN.source}.`,
    )
  }
  return normalized
}

function normalizeOptionalText(value: string | undefined) {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function slugify(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'preference'
}

function ensureUniquePreferenceKey(baseKey: string, usedKeys: Set<string>) {
  let candidate = baseKey
  let counter = 2
  while (usedKeys.has(candidate)) {
    candidate = `${baseKey}-${counter}`
    counter += 1
  }
  usedKeys.add(candidate)
  return candidate
}

export function defaultPreferenceDocument() {
  return DEFAULT_PREFERENCES
}
