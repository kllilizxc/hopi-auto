import { join } from 'node:path'

const CLAUDE_PROVIDER_ENVIRONMENT_KEYS = new Set([
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
])

export async function readClaudeProviderEnvironment(
  homeRoot = process.env.HOME,
  processEnvironment: Record<string, string | undefined> = process.env,
) {
  if (!homeRoot) return {}
  const file = Bun.file(join(homeRoot, '.claude', 'settings.json'))
  if (!(await file.exists())) return {}

  let source: unknown
  try {
    source = await file.json()
  } catch {
    return {}
  }
  if (!isRecord(source) || !isRecord(source.env)) return {}

  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(source.env)) {
    if (!isClaudeProviderEnvironmentKey(key) || typeof value !== 'string') continue
    if (processEnvironment[key] !== undefined) continue
    environment[key] = value
  }
  return environment
}

function isClaudeProviderEnvironmentKey(key: string) {
  return key.startsWith('ANTHROPIC_') || CLAUDE_PROVIDER_ENVIRONMENT_KEYS.has(key)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
