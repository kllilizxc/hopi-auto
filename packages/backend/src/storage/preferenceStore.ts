import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createProjectPaths } from './paths'

export interface PreferenceDocument {
  path: string
  content: string
}

export interface PreferenceStore {
  readPreferences(): Promise<PreferenceDocument>
  writePreferences(content: string): Promise<PreferenceDocument>
  recordPreference(summary: string): Promise<PreferenceDocument>
}

const DEFAULT_PREFERENCES = `# Preferences

Durable project preferences have not been recorded yet.
`

export function createPreferenceStore(rootDir = process.cwd()): PreferenceStore {
  const paths = createProjectPaths(rootDir)

  return {
    async readPreferences() {
      return readOrBootstrapPreferences(paths.preferencePath())
    },
    async writePreferences(content) {
      const path = paths.preferencePath()
      await mkdir(dirname(path), { recursive: true })
      await Bun.write(path, content)
      return {
        path,
        content,
      }
    },
    async recordPreference(summary) {
      const current = await readOrBootstrapPreferences(paths.preferencePath())
      const normalizedSummary = summary.trim()
      if (!normalizedSummary) {
        return current
      }

      if (isEmptyPreferenceDocument(current.content)) {
        return writePreferenceDocument(paths.preferencePath(), [normalizedSummary])
      }

      const entries = readPreferenceEntries(current.content)
      if (entries.includes(normalizedSummary)) {
        return current
      }

      if (isBulletListPreferenceDocument(current.content)) {
        return writePreferenceDocument(paths.preferencePath(), [...entries, normalizedSummary])
      }

      const separator = current.content.endsWith('\n') ? '\n' : '\n\n'
      return writePreferenceContent(
        paths.preferencePath(),
        `${current.content}${separator}- ${normalizedSummary}\n`,
      )
    },
  }
}

async function readOrBootstrapPreferences(path: string): Promise<PreferenceDocument> {
  const file = Bun.file(path)
  if (!(await file.exists())) {
    await mkdir(dirname(path), { recursive: true })
    await Bun.write(path, DEFAULT_PREFERENCES)
  }

  return {
    path,
    content: await Bun.file(path).text(),
  }
}

function isEmptyPreferenceDocument(content: string) {
  return content.trim() === '' || content.trim() === DEFAULT_PREFERENCES.trim()
}

function readPreferenceEntries(content: string) {
  return Array.from(
    new Set(
      content
        .split('\n')
        .map((line) => /^-\s+(.+)$/.exec(line.trim())?.[1]?.trim())
        .filter((line): line is string => Boolean(line)),
    ),
  )
}

function isBulletListPreferenceDocument(content: string) {
  const trimmed = content.trim()
  if (trimmed === '' || trimmed === DEFAULT_PREFERENCES.trim()) {
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

async function writePreferenceDocument(
  path: string,
  entries: string[],
): Promise<PreferenceDocument> {
  const content = renderPreferenceDocument(entries)
  return writePreferenceContent(path, content)
}

async function writePreferenceContent(path: string, content: string): Promise<PreferenceDocument> {
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, content)
  return {
    path,
    content,
  }
}

function renderPreferenceDocument(entries: string[]) {
  if (entries.length === 0) {
    return DEFAULT_PREFERENCES
  }

  return `# Preferences

${entries.map((entry) => `- ${entry}`).join('\n')}
`
}
